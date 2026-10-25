import asyncio
import json
from collections.abc import Iterator
from typing import Any

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tests.chat_stubs import ScriptedChatModel, text_turn, tool_turn
from tests.query_edit_stubs import SNAPSHOT, edit_result
from tests.test_chat_runner import RESULT, bus, frames, make_runner, new_turn, sessions, stored
from veodyn_api.models.ai_chat import AiChatDraft
from veodyn_api.schemas.ai_chat_context import ChatDataSourceEntryIn
from veodyn_api.services.chat import tools
from veodyn_api.services.chat.bus import TurnBus
from veodyn_api.services.chat.tools import ChatTool, ClientCall, Immediate, ToolContext, register_chat_tool
from veodyn_api.services.chat.turn_context import TurnContext

pytestmark = pytest.mark.anyio

__all__ = ["bus", "sessions"]

SOURCE = ChatDataSourceEntryIn(id=1, name="Trips", type="pg", syntax="sql", view_only=False)
EDIT_CONTEXT = TurnContext(instance=None, data_sources=(SOURCE,), ready_queries=())
COMPLETED = Immediate(
    content=json.dumps({"draftId": "d-1", "version": 1}),
    is_error=False,
    draft={"draftId": "d-1", "version": 1, "kind": "query_edit", "payload": {"queryId": 5}},
)


class Completions:
    def __init__(self) -> None:
        self.seen: list[dict[str, Any]] = []

    async def __call__(self, request: ClientCall, result: dict[str, Any], ctx: ToolContext) -> Immediate:
        self.seen.append(result)
        return COMPLETED


async def _echo(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    return ClientCall(call_id, "echo_edit", {"n": 1})


@pytest.fixture
def completions() -> Iterator[Completions]:
    completer = Completions()
    register_chat_tool(
        ChatTool(
            name="echo_edit",
            definition={"name": "echo_edit", "description": "Echo.", "input_schema": {"type": "object"}},
            handler=_echo,
            result_kind="query_result",
            complete=completer,
        )
    )
    yield completer
    tools._TOOLS.pop("echo_edit")


async def answer(bus: TurnBus, turn_id: str, result: dict[str, Any], *, cancel_first: bool = False) -> None:
    after: str | None = None
    while True:
        for frame_id, event, data in await bus.read(turn_id, after, block_ms=500):
            after = frame_id
            if event == "tool_request":
                if cancel_first:
                    await bus.request_cancel(turn_id)
                await bus.push_result(turn_id, {"callId": data["callId"], "result": result})
                return
            if event in ("turn_done", "error"):
                return


async def test_complete_replaces_result_and_emits_draft(
    db: Session, bus: TurnBus, sessions: Any, completions: Completions
) -> None:
    turn = new_turn(db)
    model = ScriptedChatModel(tool_turn("call-1", "echo_edit", {}), text_turn("Done."))
    run = asyncio.create_task(make_runner(model, bus, sessions).run(turn.id, turn.thread_id, 1, turn.user_text))

    await answer(bus, str(turn.id), dict(RESULT))
    await run

    assert completions.seen == [RESULT]
    sent = model.calls[1]["messages"][2]["content"][0]
    assert sent["content"] == COMPLETED.content
    assert "is_error" not in sent
    events = await frames(bus, turn)
    assert ("draft", COMPLETED.draft) in events
    names = [event for event, _ in events]
    assert names.index("tool_request") < names.index("tool_settled") < names.index("turn_done")


async def test_complete_skipped_on_failed_result(
    db: Session, bus: TurnBus, sessions: Any, completions: Completions
) -> None:
    turn = new_turn(db)
    model = ScriptedChatModel(tool_turn("call-1", "echo_edit", {}), text_turn("It failed."))
    run = asyncio.create_task(make_runner(model, bus, sessions).run(turn.id, turn.thread_id, 1, turn.user_text))

    await answer(bus, str(turn.id), {"ok": False, "error": "You cannot edit this query"})
    await run

    assert completions.seen == []
    sent = model.calls[1]["messages"][2]["content"][0]
    assert sent["is_error"] is True
    assert json.loads(sent["content"]) == {"ok": False, "error": "You cannot edit this query"}
    assert "draft" not in [event for event, _ in await frames(bus, turn)]


async def test_cancelled_before_result_stores_no_draft(db: Session, bus: TurnBus, sessions: Any) -> None:
    turn = new_turn(db)
    arguments = {"queryId": 5, "changes": {"name": "Renamed"}}
    model = ScriptedChatModel(tool_turn("call-1", "update_query", arguments), text_turn("never"))
    runner = make_runner(model, bus, sessions)
    run = asyncio.create_task(runner.run(turn.id, turn.thread_id, 1, turn.user_text, context=EDIT_CONTEXT))

    await answer(bus, str(turn.id), edit_result({"name": "Renamed"}), cancel_first=True)
    await run

    db.expire_all()
    assert db.scalar(select(func.count()).select_from(AiChatDraft).where(AiChatDraft.thread_id == turn.thread_id)) == 0
    assert "draft" not in [event for event, _ in await frames(bus, turn)]
    assert stored(db, turn).stop_reason == "cancelled"


async def test_update_query_result_stores_the_draft_when_not_cancelled(
    db: Session, bus: TurnBus, sessions: Any
) -> None:
    turn = new_turn(db)
    arguments = {"queryId": 5, "changes": {"name": "Renamed"}}
    model = ScriptedChatModel(tool_turn("call-1", "update_query", arguments), text_turn("Proposed."))
    run = asyncio.create_task(
        make_runner(model, bus, sessions).run(turn.id, turn.thread_id, 1, turn.user_text, context=EDIT_CONTEXT)
    )

    await answer(bus, str(turn.id), edit_result({"name": "Renamed"}))
    await run

    db.expire_all()
    [draft] = db.scalars(select(AiChatDraft).where(AiChatDraft.thread_id == turn.thread_id)).all()
    assert draft.kind == "query_edit"
    events = await frames(bus, turn)
    [(_, frame)] = [(name, data) for name, data in events if name == "draft"]
    assert frame["payload"] == {"queryId": 5, "snapshot": SNAPSHOT, "changes": {"name": "Renamed"}}
