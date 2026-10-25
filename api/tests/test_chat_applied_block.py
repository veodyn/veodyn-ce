import uuid
from datetime import timedelta
from typing import Any

import pytest
import redis
from sqlalchemy.orm import Session

from tests.chat_stubs import ScriptedChatModel, text_turn, tool_turn
from tests.test_chat_routes import Harness, harness, headers, model
from tests.test_chat_runner import bus, make_runner, sessions, stored
from veodyn_api.models.ai_chat import AiChatDraft
from veodyn_api.services.chat import store
from veodyn_api.services.chat.bus import TurnBus
from veodyn_api.services.chat.prompt import chat_system
from veodyn_api.services.chat.turn_context import EMPTY_CONTEXT, AppliedPromotion, TurnContext, applied_block

__all__ = ["bus", "harness", "model", "sessions"]

OWNER = "7"
HEADER = "Applied since your last turn (the analyst clicked Apply in a card; treat these as saved):"


def finish(db: Session, turn_id: uuid.UUID) -> None:
    store.finish_turn(
        db,
        turn_id,
        status="done",
        blocks=[],
        usage=None,
        stop_reason="end_turn",
        error_id=None,
        applied_delivered=True,
    )


def next_turn(db: Session, thread_id: uuid.UUID, text: str) -> list[AppliedPromotion]:
    thread = store.thread_for_owner(db, OWNER, thread_id)
    turn, applied = store.start_turn(db, thread, text)
    finish(db, turn.id)
    return applied


def started_thread(db: Session) -> tuple[uuid.UUID, AiChatDraft]:
    thread = store.create_thread(db, OWNER)
    turn, _ = store.start_turn(db, thread, "propose a query")
    draft_id, _ = store.save_draft(db, thread.id, turn.id, None, "query", {"name": "q"})
    finish(db, turn.id)
    return thread.id, store.draft_for_owner(db, OWNER, draft_id)


def test_applied_reports_resumed_promotion(db: Session) -> None:
    thread_id, draft = started_thread(db)
    promotion = store.record_promotion(
        db, draft, version=1, target_type="query", target_id=None, target_version_at_promote=None, status="pending"
    )
    [first] = next_turn(db, thread_id, "second")
    assert (first.draft_id, first.kind, first.status, first.target_id) == (str(draft.id), "query", "pending", None)
    assert next_turn(db, thread_id, "third") == []

    receipt = {"step": 0, "outcome": "done", "targetId": "7", "updatedAt": None, "error": None}
    store.update_promotion(db, draft, promotion.id, status="done", target_id="7", receipts=[receipt])

    [resumed] = next_turn(db, thread_id, "fourth")
    assert (resumed.status, resumed.target_id, resumed.target_type) == ("done", "7", "query")
    assert resumed.receipts == (receipt,)
    assert next_turn(db, thread_id, "fifth") == []


def test_applied_reports_apply_during_running_turn(db: Session) -> None:
    thread_id, draft = started_thread(db)
    thread = store.thread_for_owner(db, OWNER, thread_id)
    running, nothing = store.start_turn(db, thread, "still thinking")
    assert nothing == []
    store.record_promotion(
        db, draft, version=1, target_type="query", target_id="3", target_version_at_promote=None, status="done"
    )
    finish(db, running.id)

    [applied] = next_turn(db, thread_id, "what happened")
    assert (applied.target_id, applied.status) == ("3", "done")


def test_applied_null_cursor_reports_nothing(db: Session) -> None:
    thread_id, draft = started_thread(db)
    thread = store.thread_for_owner(db, OWNER, thread_id)
    thread.applied_reported_at = None
    db.commit()
    store.record_promotion(
        db, draft, version=1, target_type="query", target_id="3", target_version_at_promote=None, status="done"
    )

    assert next_turn(db, thread_id, "after the migration") == []
    db.refresh(thread)
    assert thread.applied_reported_at is not None
    assert next_turn(db, thread_id, "again") == []


def test_applied_block_text() -> None:
    applied = AppliedPromotion(
        draft_id="d1",
        kind="dashboard",
        target_type="dashboard",
        target_id="9",
        status="partial",
        receipts=(
            {"step": 0, "outcome": "done", "targetId": "9", "updatedAt": None, "error": None},
            {"step": 1, "outcome": "failed", "targetId": None, "updatedAt": None, "error": "node refused"},
            {"step": 2, "outcome": "skipped", "targetId": None, "updatedAt": None, "error": None},
        ),
    )
    context = TurnContext(instance=None, data_sources=None, ready_queries=(), applied=(applied,))
    assert applied_block(context) == (
        f"{HEADER}\n- draft d1 (dashboard) to dashboard 9: partial. Steps: 0 done, 1 failed (node refused), 2 skipped"
    )


def test_applied_block_without_target_or_receipts() -> None:
    applied = AppliedPromotion(
        draft_id="d2", kind="query", target_type="query", target_id=None, status="failed", receipts=()
    )
    context = TurnContext(instance=None, data_sources=None, ready_queries=(), applied=(applied,))
    assert applied_block(context) == f"{HEADER}\n- draft d2 (query) to query not created: failed."


def test_applied_block_is_absent_when_nothing_was_applied() -> None:
    assert applied_block(EMPTY_CONTEXT) is None


def test_the_system_prompt_ends_with_the_applied_block() -> None:
    applied = AppliedPromotion(
        draft_id="d2", kind="query", target_type="query", target_id="5", status="done", receipts=()
    )
    context = TurnContext(instance=None, data_sources=None, ready_queries=(), applied=(applied,))
    system = chat_system((), omitted_history=False, context=context)
    assert system[-1]["text"] == applied_block(context)


def test_the_next_turn_hears_what_was_applied(harness: Harness, db: Session) -> None:
    harness.model.turns.extend([text_turn("one"), text_turn("two")])
    thread = harness.thread()
    first = harness.turn(thread, "propose")
    harness.wait_for(first, "turn_done")
    thread_id = uuid.UUID(thread)
    turn, _ = store.start_turn(db, store.thread_for_owner(db, OWNER, thread_id), "direct")
    draft_id, _ = store.save_draft(db, thread_id, turn.id, None, "query", {"name": "q"})
    finish(db, turn.id)
    response = harness.client.post(
        f"/ai/chat/drafts/{draft_id}/promotions",
        json={"version": 1, "targetType": "query", "targetId": "44"},
        headers=headers(),
    )
    assert response.status_code == 201, response.text

    second = harness.turn(thread, "what was saved?")
    harness.wait_for(second, "turn_done")

    texts = [block["text"] for block in harness.model.calls[-1]["system"]]
    assert f"{HEADER}\n- draft {draft_id} (query) to query 44: done." in texts


def fail(db: Session, thread_id: uuid.UUID, text: str) -> list[AppliedPromotion]:
    thread = store.thread_for_owner(db, OWNER, thread_id)
    turn, applied = store.start_turn(db, thread, text)
    assert store.fail_turn(db, turn.id, "X")
    return applied


def test_a_failed_turn_leaves_the_promotion_unreported(db: Session) -> None:
    thread_id, draft = started_thread(db)
    next_turn(db, thread_id, "set the cursor")
    store.record_promotion(
        db, draft, version=1, target_type="query", target_id="3", target_version_at_promote=None, status="done"
    )

    [first] = fail(db, thread_id, "this one fails")
    [again] = next_turn(db, thread_id, "retry")

    assert (first.target_id, again.target_id) == ("3", "3")
    assert next_turn(db, thread_id, "after") == []


def test_a_done_turn_does_not_repeat_the_promotion(db: Session) -> None:
    thread_id, draft = started_thread(db)
    next_turn(db, thread_id, "set the cursor")
    store.record_promotion(
        db, draft, version=1, target_type="query", target_id="3", target_version_at_promote=None, status="done"
    )
    assert len(next_turn(db, thread_id, "reports")) == 1
    assert next_turn(db, thread_id, "silent") == []


def test_the_cursor_never_moves_backwards(db: Session) -> None:
    thread_id, _ = started_thread(db)
    next_turn(db, thread_id, "first")
    thread = store.thread_for_owner(db, OWNER, thread_id)
    turn, _ = store.start_turn(db, thread, "second")
    before = thread.applied_reported_at
    assert before is not None
    turn.applied_cutoff = before - timedelta(days=1)
    db.commit()
    finish(db, turn.id)
    db.refresh(thread)
    assert thread.applied_reported_at == before


def test_a_lease_failure_in_post_turn_does_not_lose_the_promotion(
    harness: Harness, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    harness.model.turns.append(text_turn("ok"))
    thread = harness.thread()
    first = harness.turn(thread, "set the cursor")
    harness.wait_for(first, "turn_done")
    thread_id = uuid.UUID(thread)
    turn, _ = store.start_turn(db, store.thread_for_owner(db, OWNER, thread_id), "direct")
    draft_id, _ = store.save_draft(db, thread_id, turn.id, None, "query", {"name": "q"})
    store.fail_turn(db, turn.id, "X")
    harness.client.post(
        f"/ai/chat/drafts/{draft_id}/promotions",
        json={"version": 1, "targetType": "query", "targetId": "44"},
        headers=headers(),
    )

    async def broken(self: TurnBus, turn_id: str) -> None:
        raise redis.exceptions.ConnectionError("down")

    with monkeypatch.context() as patch:
        patch.setattr(TurnBus, "hold_lease", broken)
        refused = harness.client.post(f"/ai/chat/threads/{thread}/turns", json={"text": "lost"}, headers=headers())
    assert refused.status_code == 503

    harness.model.turns.append(text_turn("ok"))
    second = harness.turn(thread, "what was saved?")
    harness.wait_for(second, "turn_done")
    texts = [block["text"] for block in harness.model.calls[-1]["system"]]
    assert f"{HEADER}\n- draft {draft_id} (query) to query 44: done." in texts


async def cancelled_turn(db: Session, bus: TurnBus, sessions: Any, *, after_model_call: bool) -> uuid.UUID:
    thread_id, draft = started_thread(db)
    next_turn(db, thread_id, "set the cursor")
    store.record_promotion(
        db, draft, version=1, target_type="query", target_id="3", target_version_at_promote=None, status="done"
    )
    thread = store.thread_for_owner(db, OWNER, thread_id)
    turn, applied = store.start_turn(db, thread, "cancelled")
    assert len(applied) == 1

    async def cancel_then_call_an_unknown_tool() -> Any:
        await bus.request_cancel(str(turn.id))
        return tool_turn("call-1", "no_such_tool", {})

    if not after_model_call:
        await bus.request_cancel(str(turn.id))
    model = ScriptedChatModel(cancel_then_call_an_unknown_tool) if after_model_call else ScriptedChatModel()
    await make_runner(model, bus, sessions).run(turn.id, thread_id, turn.seq, turn.user_text)
    assert stored(db, turn).stop_reason == "cancelled"
    assert bool(model.calls) is after_model_call
    return thread_id


@pytest.mark.anyio
async def test_a_turn_cancelled_before_the_model_ran_leaves_the_promotion_unreported(
    db: Session, bus: TurnBus, sessions: Any
) -> None:
    thread_id = await cancelled_turn(db, bus, sessions, after_model_call=False)
    [again] = next_turn(db, thread_id, "retry")
    assert again.target_id == "3"


@pytest.mark.anyio
async def test_a_turn_cancelled_after_the_model_ran_advances_the_cursor(
    db: Session, bus: TurnBus, sessions: Any
) -> None:
    thread_id = await cancelled_turn(db, bus, sessions, after_model_call=True)
    assert next_turn(db, thread_id, "next") == []
