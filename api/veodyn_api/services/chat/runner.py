import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from sqlalchemy.orm import Session

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.services.ai_viz_catalog import DEFAULT_CATALOG, VizCatalog
from veodyn_api.services.chat import store
from veodyn_api.services.chat.bus import TurnBus
from veodyn_api.services.chat.driver import ChatModel
from veodyn_api.services.chat.prompt import chat_system
from veodyn_api.services.chat.tools import (
    ClientCall,
    DataSourceInfo,
    Immediate,
    ToolContext,
    prepare_call,
    tool_definitions,
)

logger = logging.getLogger(__name__)

MAX_TOOL_HOPS = 8
TURN_SECONDS = 300.0
TOOL_WAIT_SECONDS = 120.0
TOOL_WAIT_SLICE_SECONDS = 2.0
HISTORY_BUDGET = 120_000
LEASE_REFRESH_SECONDS = 5.0

REFUSAL_TEXT = "I can't help with that request."
HOP_LIMIT_TEXT = (
    f"I stopped after {MAX_TOOL_HOPS} steps without finishing. Ask me to continue, or narrow the question."
)
TIMED_OUT_RESULT = {"ok": False, "error": "the browser did not return a result in time"}
CANCELLED_RESULT = {"ok": False, "error": "the analyst stopped this turn"}

T = TypeVar("T")
Sessions = Callable[[], Session]
DatasetLoader = Callable[[], Awaitable[tuple[DatasetOut, ...]]]
DataSourceLoader = Callable[[], Awaitable[int]]

_RUNNING: set[asyncio.Task[None]] = set()


def _tool_result(call_id: str, content: str, is_error: bool) -> dict[str, Any]:
    block: dict[str, Any] = {"type": "tool_result", "tool_use_id": call_id, "content": content}
    if is_error:
        block["is_error"] = True
    return block


def _merge_usage(total: dict[str, Any], usage: dict[str, Any]) -> None:
    for key, value in usage.items():
        if isinstance(value, int) and not isinstance(value, bool):
            total[key] = int(total.get(key, 0)) + value
        elif key == "model":
            total[key] = value


def _parse_uuid(value: str | None) -> uuid.UUID | None:
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


def _tool_results_in(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for message in blocks:
        if message.get("role") != "user":
            continue
        for item in message.get("content") or []:
            if not isinstance(item, dict) or item.get("type") != "tool_result":
                continue
            try:
                parsed = json.loads(item.get("content") or "")
            except (TypeError, ValueError):
                continue
            if isinstance(parsed, dict):
                found.append(parsed)
    return found


def _scanned_data_source_info(blocks: list[dict[str, Any]], source_id: int) -> DataSourceInfo | None:
    syntax = ""
    view_only: bool | None = None
    resources: dict[str, tuple[str, ...]] | None = None
    for result in _tool_results_in(blocks):
        kind = result.get("kind")
        if kind == "data_sources":
            for source in result.get("sources") or []:
                if isinstance(source, dict) and source.get("id") == source_id:
                    syntax = str(source.get("syntax") or syntax)
                    view_only = bool(source.get("viewOnly"))
        elif kind == "data_source_schema" and result.get("dataSourceId") == source_id:
            syntax = str(result.get("syntax") or syntax)
            if result.get("ok") and isinstance(result.get("resources"), list):
                resources = {
                    str(entry["name"]): tuple(str(one) for one in entry.get("params") or [])
                    for entry in result["resources"]
                    if isinstance(entry, dict) and entry.get("name")
                }
    if not syntax:
        return None
    return DataSourceInfo(syntax=syntax, view_only=view_only, resources=resources)


class TurnRunner:
    def __init__(
        self,
        *,
        model: ChatModel,
        bus: TurnBus,
        sessions: Sessions,
        datasets: DatasetLoader,
        data_source_id: DataSourceLoader,
    ) -> None:
        self._model = model
        self._bus = bus
        self._sessions = sessions
        self._datasets = datasets
        self._data_source_id = data_source_id

    async def _db(self, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        def call() -> T:
            with self._sessions() as session:
                return fn(session, *args, **kwargs)

        return await asyncio.to_thread(call)

    async def _keep_lease(self, key: str) -> None:
        while True:
            await asyncio.sleep(LEASE_REFRESH_SECONDS)
            try:
                await self._bus.hold_lease(key)
            except Exception:
                logger.warning("a chat turn could not refresh its lease", exc_info=True)

    async def run(
        self,
        turn_id: uuid.UUID,
        thread_id: uuid.UUID,
        seq: int,
        text: str,
        catalog: VizCatalog = DEFAULT_CATALOG,
    ) -> None:
        key = str(turn_id)
        blocks: list[dict[str, Any]] = []
        usage: dict[str, Any] = {}
        await self._bus.hold_lease(key)
        lease = asyncio.create_task(self._keep_lease(key))
        try:
            await self._bus.emit(key, "turn_started", {"turnId": key, "seq": seq})
            async with asyncio.timeout(TURN_SECONDS):
                stop_reason = await self._loop(key, turn_id, thread_id, seq, text, blocks, usage, catalog)
            await self._db(
                store.finish_turn,
                turn_id,
                status="done",
                blocks=blocks,
                usage=usage or None,
                stop_reason=stop_reason,
                error_id=None,
            )
            await self._bus.emit(key, "turn_done", {"stopReason": stop_reason, "usage": usage})
        except TimeoutError:
            await self._fail(key, turn_id, blocks, usage, ErrorId.AI_TURN_TIMEOUT, "The turn took too long.")
        except ApiError as refused:
            await self._fail(key, turn_id, blocks, usage, refused.error_id, refused.message)
        except asyncio.CancelledError:
            await self._fail(key, turn_id, blocks, usage, ErrorId.AI_TURN_LOST, "The turn was interrupted.")
            raise
        except Exception:
            logger.exception("a chat turn failed")
            await self._fail(key, turn_id, blocks, usage, ErrorId.INTERNAL_ERROR, "The turn failed.")
        finally:
            lease.cancel()
            for cleanup in (self._bus.release_lease, self._bus.clear_pending, self._bus.seal):
                try:
                    await cleanup(key)
                except Exception:
                    logger.warning("a chat turn could not clean up after itself", exc_info=True)

    async def _fail(
        self,
        key: str,
        turn_id: uuid.UUID,
        blocks: list[dict[str, Any]],
        usage: dict[str, Any],
        error_id: ErrorId,
        message: str,
    ) -> None:
        try:
            await self._db(
                store.finish_turn,
                turn_id,
                status="failed",
                blocks=blocks,
                usage=usage or None,
                stop_reason=None,
                error_id=error_id.value,
            )
            await self._bus.emit(key, "error", {"id": error_id.value, "message": message})
        except Exception:
            logger.exception("a failed chat turn could not be recorded")

    async def _loop(
        self,
        key: str,
        turn_id: uuid.UUID,
        thread_id: uuid.UUID,
        seq: int,
        text: str,
        blocks: list[dict[str, Any]],
        usage: dict[str, Any],
        catalog: VizCatalog,
    ) -> str:
        history, omitted = await self._db(store.replay, thread_id, seq, HISTORY_BUDGET)
        datasets = await self._datasets()
        system = chat_system(datasets, omitted_history=omitted, catalog=catalog)
        tools = tool_definitions(catalog)
        opening = [*history, {"role": "user", "content": [{"type": "text", "text": text}]}]

        async def save_draft(kind: str, draft_id: str | None, payload: dict[str, Any]) -> tuple[str, int]:
            saved, version = await self._db(store.save_draft, thread_id, turn_id, _parse_uuid(draft_id), kind, payload)
            return str(saved), version

        async def query_draft_exists(draft_id: str) -> bool:
            parsed = _parse_uuid(draft_id)
            if parsed is None:
                return False
            return await self._db(store.query_draft_exists, thread_id, parsed)

        async def on_text(delta: str) -> None:
            await self._bus.emit(key, "text_delta", {"text": delta})

        def data_source_info(source_id: int) -> DataSourceInfo | None:
            return _scanned_data_source_info(blocks, source_id)

        ctx = ToolContext(
            datasets=datasets,
            data_source_id=self._data_source_id,
            data_source_info=data_source_info,
            save_draft=save_draft,
            query_draft_exists=query_draft_exists,
            catalog=catalog,
        )
        for _ in range(MAX_TOOL_HOPS):
            if await self._bus.cancel_requested(key):
                return "cancelled"
            await self._bus.emit(key, "status", {"phase": "answering"})
            turn = await self._model.run(system=system, messages=[*opening, *blocks], tools=tools, on_text=on_text)
            _merge_usage(usage, turn.usage)
            content = list(turn.content)
            blocks.append({"role": "assistant", "content": content})
            if turn.stop_reason == "refusal":
                content.append({"type": "text", "text": REFUSAL_TEXT})
                await on_text(REFUSAL_TEXT)
                return "refusal"
            calls = [block for block in content if block.get("type") == "tool_use"]
            if not calls:
                return turn.stop_reason
            results: list[dict[str, Any]] = []
            for call in calls:
                results.append(await self._dispatch(key, call, ctx))
            blocks.append({"role": "user", "content": results})
        blocks.append({"role": "assistant", "content": [{"type": "text", "text": HOP_LIMIT_TEXT}]})
        await on_text(HOP_LIMIT_TEXT)
        return "tool_hop_limit"

    async def _dispatch(self, key: str, call: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
        call_id = str(call.get("id") or "")
        await self._bus.emit(key, "status", {"phase": "validating"})
        outcome = await prepare_call(call, ctx)
        if isinstance(outcome, Immediate):
            if outcome.draft is not None:
                await self._bus.emit(key, "draft", outcome.draft)
            if outcome.frame is not None:
                await self._bus.emit(key, *outcome.frame)
            return _tool_result(call_id, outcome.content, outcome.is_error)
        return await self._round_trip(key, outcome)

    async def _round_trip(self, key: str, request: ClientCall) -> dict[str, Any]:
        await self._bus.set_pending(key, request.call_id, request.tool)
        await self._bus.emit(key, "status", {"phase": "waiting_for_browser"})
        await self._bus.emit(
            key, "tool_request", {"callId": request.call_id, "tool": request.tool, "args": request.args}
        )
        started = asyncio.get_running_loop().time()
        result = await self._await_result(key, request.call_id)
        await self._bus.clear_pending(key)
        elapsed_ms = int((asyncio.get_running_loop().time() - started) * 1000)
        ok = result.get("ok") is True
        settled: dict[str, Any] = {"callId": request.call_id, "ok": ok, "durationMs": elapsed_ms}
        if isinstance(result.get("rowCount"), int):
            settled["rowCount"] = result["rowCount"]
        listed = result.get("items", result.get("widgets"))
        if isinstance(listed, list):
            settled["count"] = len(listed)
        sources = result.get("sources")
        if isinstance(sources, list):
            settled["sourceCount"] = len(sources)
        await self._bus.emit(key, "status", {"phase": "reading_result"})
        await self._bus.emit(key, "tool_settled", settled)
        return _tool_result(request.call_id, json.dumps(result, separators=(",", ":")), not ok)

    async def _await_result(self, key: str, call_id: str) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + TOOL_WAIT_SECONDS
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                return dict(TIMED_OUT_RESULT)
            posted = await self._bus.wait_result(key, min(TOOL_WAIT_SLICE_SECONDS, remaining))
            if posted is not None and posted.get("callId") == call_id and isinstance(posted.get("result"), dict):
                return dict(posted["result"])
            if await self._bus.cancel_requested(key):
                return dict(CANCELLED_RESULT)


def spawn_turn(
    runner: TurnRunner,
    turn_id: uuid.UUID,
    thread_id: uuid.UUID,
    seq: int,
    text: str,
    catalog: VizCatalog = DEFAULT_CATALOG,
) -> asyncio.Task[None]:
    task = asyncio.create_task(runner.run(turn_id, thread_id, seq, text, catalog))
    _RUNNING.add(task)
    task.add_done_callback(_RUNNING.discard)
    return task


async def cancel_running_turns() -> None:
    tasks = list(_RUNNING)
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
