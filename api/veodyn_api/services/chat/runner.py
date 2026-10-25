import asyncio
import logging
import uuid
from collections.abc import Callable
from typing import Any, TypeVar

from sqlalchemy.orm import Session

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.services.ai_viz_catalog import DEFAULT_CATALOG, VizCatalog
from veodyn_api.services.chat import store
from veodyn_api.services.chat.bus import TurnBus
from veodyn_api.services.chat.closing import CLOSING_RESERVE_SECONDS, close_turn, settle_pending
from veodyn_api.services.chat.driver import ChatModel
from veodyn_api.services.chat.prompt import chat_system
from veodyn_api.services.chat.tool_context import (
    DatasetLoader,
    DataSourceLoader,
    DraftHooks,
    build_tool_context,
    complete_result,
    fixed_scope,
    settled_content,
    tool_result_block,
    visible_datasets,
)
from veodyn_api.services.chat.tools import (
    ClientCall,
    Immediate,
    ToolContext,
    completer_for,
    prepare_call,
    result_kind_for,
    tool_definitions,
)
from veodyn_api.services.chat.turn_context import EMPTY_CONTEXT, TurnContext

logger = logging.getLogger(__name__)

MAX_TOOL_HOPS = 30
TURN_SECONDS = 300.0
TOOL_WAIT_SECONDS = 120.0
TOOL_WAIT_SLICE_SECONDS = 2.0
HISTORY_BUDGET = 120_000
LEASE_REFRESH_SECONDS = 5.0

REFUSAL_TEXT = "I can't help with that request."
TIMED_OUT_RESULT = {"ok": False, "error": "the browser did not return a result in time"}
CANCELLED_RESULT = {"ok": False, "error": "the analyst stopped this turn"}

T = TypeVar("T")
Sessions = Callable[[], Session]

_RUNNING: set[asyncio.Task[None]] = set()


def _monotonic() -> float:
    return asyncio.get_running_loop().time()


def _merge_usage(total: dict[str, Any], usage: dict[str, Any]) -> None:
    for key, value in usage.items():
        if isinstance(value, int) and not isinstance(value, bool):
            total[key] = int(total.get(key, 0)) + value
        elif key == "model":
            total[key] = value


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
        context: TurnContext = EMPTY_CONTEXT,
    ) -> None:
        key = str(turn_id)
        blocks: list[dict[str, Any]] = []
        usage: dict[str, Any] = {}
        await self._bus.hold_lease(key)
        lease = asyncio.create_task(self._keep_lease(key))
        try:
            await self._bus.emit(key, "turn_started", {"turnId": key, "seq": seq})
            async with asyncio.timeout(TURN_SECONDS):
                stop_reason = await self._loop(key, turn_id, thread_id, seq, text, blocks, usage, catalog, context)
            await self._db(
                store.finish_turn,
                turn_id,
                status="done",
                blocks=blocks,
                usage=usage or None,
                stop_reason=stop_reason,
                error_id=None,
                applied_delivered=bool(blocks),
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
        context: TurnContext,
    ) -> str:
        history, omitted = await self._db(store.replay, thread_id, seq, HISTORY_BUDGET)
        datasets = await visible_datasets(self._datasets, self._data_source_id, context.data_sources)
        system = chat_system(datasets, omitted_history=omitted, catalog=catalog, context=context)
        instance = context.instance
        tools = tool_definitions(
            catalog, instance.edition if instance else None, instance.features if instance else None
        )
        opening = [*history, {"role": "user", "content": [{"type": "text", "text": text}]}]

        hooks = DraftHooks(self._db, fixed_scope(thread_id, turn_id), thread_id)

        async def on_text(delta: str) -> None:
            await self._bus.emit(key, "text_delta", {"text": delta})

        ctx = build_tool_context(
            datasets=datasets,
            data_source_id=self._data_source_id,
            sources=context.data_sources,
            transcript=blocks,
            hooks=hooks,
            catalog=catalog,
            edition=instance.edition if instance else None,
            features=tuple(instance.features) if instance else None,
        )
        deadline = _monotonic() + TURN_SECONDS
        wait_until = deadline - CLOSING_RESERVE_SECONDS
        for _ in range(MAX_TOOL_HOPS):
            if await self._bus.cancel_requested(key):
                return "cancelled"
            if _monotonic() >= wait_until:
                break
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
            blocks.append({"role": "user", "content": results})
            for call in calls:
                if _monotonic() >= wait_until:
                    break
                results.append(await self._dispatch(key, call, ctx, wait_until))
            settle_pending(blocks, [str(call.get("id") or "") for call in calls[len(results) :]])
        if await self._bus.cancel_requested(key):
            return "cancelled"
        await self._bus.emit(key, "status", {"phase": "answering"})
        return await close_turn(
            self._model, system, opening, blocks, on_text, tools=tools, on_usage=lambda used: _merge_usage(usage, used)
        )

    async def _dispatch(self, key: str, call: dict[str, Any], ctx: ToolContext, wait_until: float) -> dict[str, Any]:
        call_id = str(call.get("id") or "")
        await self._bus.emit(key, "status", {"phase": "validating"})
        outcome = await prepare_call(call, ctx)
        if isinstance(outcome, Immediate):
            if outcome.draft is not None:
                await self._bus.emit(key, "draft", outcome.draft)
            if outcome.frame is not None:
                await self._bus.emit(key, *outcome.frame)
            return tool_result_block(call_id, outcome.content, outcome.is_error)
        return await self._round_trip(key, outcome, ctx, wait_until)

    async def _complete(
        self, key: str, request: ClientCall, result: dict[str, Any], ctx: ToolContext
    ) -> tuple[dict[str, Any], Immediate | None]:
        if result.get("ok") is True and completer_for(request.tool) is not None:
            if await self._bus.cancel_requested(key):
                return dict(CANCELLED_RESULT), None
        return result, await complete_result(request, result, ctx)

    async def _round_trip(self, key: str, request: ClientCall, ctx: ToolContext, wait_until: float) -> dict[str, Any]:
        await self._bus.set_pending(key, request.call_id, request.tool)
        await self._bus.emit(key, "status", {"phase": "waiting_for_browser"})
        frame: dict[str, Any] = {"callId": request.call_id, "tool": request.tool, "args": request.args}
        expected_kind = result_kind_for(request.tool)
        if expected_kind is not None:
            frame["resultKind"] = expected_kind
        await self._bus.emit(key, "tool_request", frame)
        started = _monotonic()
        result = await self._await_result(key, request.call_id, wait_until)
        await self._bus.clear_pending(key)
        result, completed = await self._complete(key, request, result, ctx)
        if completed is not None:
            if completed.draft is not None:
                await self._bus.emit(key, "draft", completed.draft)
            if completed.frame is not None:
                await self._bus.emit(key, *completed.frame)
        elapsed_ms = int((_monotonic() - started) * 1000)
        ok = result.get("ok") is True and not (completed is not None and completed.is_error)
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
        content, is_error = settled_content(result, completed)
        return tool_result_block(request.call_id, content, is_error)

    async def _await_result(self, key: str, call_id: str, wait_until: float) -> dict[str, Any]:
        deadline = min(_monotonic() + TOOL_WAIT_SECONDS, wait_until)
        while True:
            remaining = deadline - _monotonic()
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
    context: TurnContext = EMPTY_CONTEXT,
) -> asyncio.Task[None]:
    task = asyncio.create_task(runner.run(turn_id, thread_id, seq, text, catalog, context))
    _RUNNING.add(task)
    task.add_done_callback(_RUNNING.discard)
    return task


async def cancel_running_turns() -> None:
    tasks = list(_RUNNING)
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
