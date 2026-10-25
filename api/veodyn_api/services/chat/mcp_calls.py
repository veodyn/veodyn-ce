import json
import logging
import uuid
from dataclasses import dataclass
from typing import Any

from redis.exceptions import RedisError

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.schemas.ai_chat_mcp import (
    McpCallContextIn,
    McpCallOut,
    McpClientCallOut,
    McpDoneOut,
    McpDraftOut,
)
from veodyn_api.services.ai_text import text_of
from veodyn_api.services.ai_viz_catalog import catalog_from
from veodyn_api.services.chat import store
from veodyn_api.services.chat.bus import TurnBus
from veodyn_api.services.chat.mcp_tools import THREAD_ID_FIELD, mcp_arguments, mcp_tool_named
from veodyn_api.services.chat.tool_context import (
    DatasetLoader,
    DataSourceLoader,
    DbCall,
    DraftHooks,
    DraftScope,
    build_tool_context,
    complete_result,
    parse_uuid,
    settled_content,
    tool_result_block,
    visible_datasets,
)
from veodyn_api.services.chat.tools import ClientCall, ToolContext, is_offered, prepare_call

logger = logging.getLogger(__name__)

CLOSING_TEXT = "Proposed from an MCP client; review it here."
DEFAULT_TITLE = "MCP proposal"
NO_SUCH_THREAD = "no such conversation"


@dataclass(frozen=True)
class McpEnvironment:
    db: DbCall
    owner: str
    bus: TurnBus
    datasets: DatasetLoader
    data_source_id: DataSourceLoader


def _no_such_thread() -> ApiError:
    return ApiError(ErrorId.AI_CHAT_NOT_FOUND, NO_SUCH_THREAD, status_code=404)


def _transcript(context: McpCallContextIn) -> list[dict[str, Any]]:
    return [
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": f"schema-{position}",
                    "content": json.dumps(schema.model_dump(by_alias=True, exclude_none=True, mode="json")),
                }
            ],
        }
        for position, schema in enumerate(context.schemas or [])
    ]


class McpScope:
    def __init__(self, environment: McpEnvironment, tool: str, thread_id: uuid.UUID | None) -> None:
        self._environment = environment
        self._tool = tool
        self.thread_id = thread_id
        self.turn_id: uuid.UUID | None = None

    async def open(self, payload: dict[str, Any]) -> DraftScope:
        if self.turn_id is None:
            title = text_of(payload.get("name"), store.TITLE_CHARS) or DEFAULT_TITLE
            thread, turn = await self._environment.db(
                store.create_mcp_turn,
                self._environment.owner,
                thread_id=self.thread_id,
                user_text=f"via MCP: {self._tool}",
                title=title,
            )
            self.thread_id, self.turn_id = thread.id, turn.id
            try:
                await self._environment.bus.hold_lease(str(turn.id))
            except (RedisError, OSError) as exc:
                await self.fail()
                raise ApiError(ErrorId.AI_CHAT_UNAVAILABLE, "chat storage is unavailable", 503) from exc
        assert self.thread_id is not None
        return self.thread_id, self.turn_id

    async def finish(self, call_id: str, tool_input: dict[str, Any], content: str, is_error: bool) -> None:
        if self.turn_id is None:
            return
        blocks = [
            {
                "role": "assistant",
                "content": [{"type": "tool_use", "id": call_id, "name": self._tool, "input": tool_input}],
            },
            {"role": "user", "content": [tool_result_block(call_id, content, is_error)]},
            {"role": "assistant", "content": [{"type": "text", "text": CLOSING_TEXT}]},
        ]
        try:
            await self._environment.db(
                store.finish_turn,
                self.turn_id,
                status="done",
                blocks=blocks,
                usage=None,
                stop_reason="end_turn",
                error_id=None,
            )
        finally:
            await self._release()

    async def fail(self) -> None:
        if self.turn_id is not None:
            try:
                await self._environment.db(store.fail_turn, self.turn_id, ErrorId.INTERNAL_ERROR.value)
            finally:
                await self._release()

    async def _release(self) -> None:
        try:
            await self._environment.bus.release_lease(str(self.turn_id))
        except (RedisError, OSError):
            logger.warning("an MCP turn could not release its lease", exc_info=True)

    def draft_out(self, draft: dict[str, Any] | None) -> McpDraftOut | None:
        if draft is None or self.thread_id is None:
            return None
        return McpDraftOut(
            draft_id=str(draft["draftId"]),
            version=int(draft["version"]),
            thread_id=str(self.thread_id),
            url=f"/chat/{self.thread_id}",
        )


async def _tool_context(environment: McpEnvironment, context: McpCallContextIn, scope: McpScope) -> ToolContext:
    sources = tuple(context.data_sources) if context.data_sources is not None else None
    datasets = await visible_datasets(environment.datasets, environment.data_source_id, sources)
    hooks = DraftHooks(environment.db, scope.open, scope.thread_id)
    shapes = [shape.model_dump() for shape in context.viz_catalog] if context.viz_catalog else None
    return build_tool_context(
        datasets=datasets,
        data_source_id=environment.data_source_id,
        sources=sources,
        transcript=_transcript(context),
        hooks=hooks,
        catalog=catalog_from(shapes),
        edition=context.instance.edition if context.instance else None,
        features=tuple(context.instance.features) if context.instance else None,
    )


async def _owned_thread(environment: McpEnvironment, raw: Any) -> uuid.UUID | None:
    if raw is None or raw == "":
        return None
    parsed = parse_uuid(raw) if isinstance(raw, str) else None
    if parsed is None:
        raise _no_such_thread()
    await environment.db(store.thread_for_owner, environment.owner, parsed)
    return parsed


async def start_call(
    environment: McpEnvironment, bus: TurnBus, name: str, arguments: dict[str, Any], context: McpCallContextIn
) -> McpCallOut:
    tool = mcp_tool_named(name)
    instance = context.instance
    if tool is None or not is_offered(
        tool, instance.edition if instance else None, instance.features if instance else None
    ):
        return McpDoneOut(content=f"there is no tool called {name!r}", is_error=True)
    thread_id = await _owned_thread(environment, arguments.get(THREAD_ID_FIELD)) if tool.proposal else None
    prepared = mcp_arguments(tool, {key: value for key, value in arguments.items() if key != THREAD_ID_FIELD})
    scope = McpScope(environment, name, thread_id)
    call_id = uuid.uuid4().hex
    try:
        ctx = await _tool_context(environment, context, scope)
        outcome = await prepare_call({"id": call_id, "name": name, "input": prepared}, ctx)
        if isinstance(outcome, ClientCall):
            await bus.put_mcp_call(
                outcome.call_id,
                {
                    "subject": environment.owner,
                    "tool": outcome.tool,
                    "args": outcome.args,
                    "name": name,
                    "input": prepared,
                    "threadId": str(thread_id) if thread_id else None,
                    "context": context.model_dump(by_alias=True, exclude_none=True, mode="json"),
                },
            )
            return McpClientCallOut(call_id=outcome.call_id, tool=outcome.tool, args=outcome.args)
        await scope.finish(call_id, prepared, outcome.content, outcome.is_error)
    except BaseException:
        await scope.fail()
        raise
    return McpDoneOut(content=outcome.content, is_error=outcome.is_error, draft=scope.draft_out(outcome.draft))


async def finish_call(
    environment: McpEnvironment, call_id: str, stored: dict[str, Any], result: dict[str, Any]
) -> McpDoneOut:
    name = str(stored["name"])
    raw_thread = stored.get("threadId")
    scope = McpScope(environment, name, uuid.UUID(raw_thread) if raw_thread else None)
    try:
        context = McpCallContextIn.model_validate(stored.get("context") or {})
        ctx = await _tool_context(environment, context, scope)
        request = ClientCall(call_id=call_id, tool=str(stored["tool"]), args=dict(stored["args"]))
        completed = await complete_result(request, result, ctx)
        content, is_error = settled_content(result, completed)
        await scope.finish(call_id, dict(stored.get("input") or {}), content, is_error)
    except BaseException:
        await scope.fail()
        raise
    return McpDoneOut(
        content=content, is_error=is_error, draft=scope.draft_out(completed.draft if completed else None)
    )
