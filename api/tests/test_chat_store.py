import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.models.ai_chat import AiChatDraft, AiChatTurn
from veodyn_api.services.chat import store

OWNER = "7"
OTHER = "8"


def answered(db: Session, owner_thread: uuid.UUID, text: str, reply: str) -> AiChatTurn:
    thread = store.thread_for_owner(db, OWNER, owner_thread)
    turn = store.start_turn(db, thread, text)
    store.finish_turn(
        db,
        turn.id,
        status="done",
        blocks=[{"role": "assistant", "content": [{"type": "text", "text": reply}]}],
        usage={"input_tokens": 1},
        stop_reason="end_turn",
        error_id=None,
    )
    return turn


def test_every_reader_hides_another_owners_rows(db: Session) -> None:
    thread = store.create_thread(db, OWNER)
    turn = store.start_turn(db, thread, "hello")
    draft_id, _ = store.save_draft(db, thread.id, turn.id, None, "query", {"name": "q"})
    for read in (
        lambda: store.thread_for_owner(db, OTHER, thread.id),
        lambda: store.turn_for_owner(db, OTHER, turn.id),
        lambda: store.draft_for_owner(db, OTHER, draft_id),
        lambda: store.thread_detail(db, OTHER, thread.id),
        lambda: store.update_thread(db, OTHER, thread.id, title="x", pinned=None),
        lambda: store.delete_thread(db, OTHER, thread.id),
    ):
        with pytest.raises(ApiError) as refused:
            read()
        assert refused.value.status_code == 404
        assert refused.value.error_id is ErrorId.AI_CHAT_NOT_FOUND
    assert store.list_threads(db, OTHER, offset=0, limit=50) == []


def test_threads_list_pinned_first_then_most_recent(db: Session) -> None:
    old = store.create_thread(db, OWNER)
    new = store.create_thread(db, OWNER)
    pinned = store.create_thread(db, OWNER)
    old.last_turn_at = datetime.now(UTC) - timedelta(days=2)
    new.last_turn_at = datetime.now(UTC)
    pinned.last_turn_at = datetime.now(UTC) - timedelta(days=5)
    pinned.pinned = True
    db.commit()
    assert [one.id for one in store.list_threads(db, OWNER, offset=0, limit=50)] == [pinned.id, new.id, old.id]
    assert [one.id for one in store.list_threads(db, OWNER, offset=1, limit=1)] == [new.id]


def test_the_first_message_names_the_thread(db: Session) -> None:
    thread = store.create_thread(db, OWNER)
    store.start_turn(db, thread, "  revenue   by route " + "x" * 200)
    store.start_turn(db, thread, "second message")
    title = store.thread_for_owner(db, OWNER, thread.id).title
    assert title.startswith("revenue by route x")
    assert len(title) == store.TITLE_CHARS


def test_turns_are_numbered_per_thread(db: Session) -> None:
    thread = store.create_thread(db, OWNER)
    assert [store.start_turn(db, thread, str(n)).seq for n in range(3)] == [1, 2, 3]
    assert store.start_turn(db, store.create_thread(db, OWNER), "a").seq == 1


def test_a_full_thread_refuses_another_turn(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(store, "MAX_TURNS_PER_THREAD", 2)
    thread = store.create_thread(db, OWNER)
    store.start_turn(db, thread, "a")
    store.start_turn(db, thread, "b")
    with pytest.raises(ApiError) as refused:
        store.start_turn(db, thread, "c")
    assert refused.value.status_code == 409
    assert refused.value.error_id is ErrorId.AI_TURN_CONFLICT


def test_running_turn_is_found_until_it_finishes(db: Session) -> None:
    thread = store.create_thread(db, OWNER)
    turn = store.start_turn(db, thread, "a")
    running = store.running_turn(db, thread.id)
    assert running is not None and running.id == turn.id
    store.finish_turn(db, turn.id, status="done", blocks=[], usage=None, stop_reason="end_turn", error_id=None)
    assert store.running_turn(db, thread.id) is None


def test_fail_turn_leaves_a_finished_turn_alone(db: Session) -> None:
    thread = store.create_thread(db, OWNER)
    finished = answered(db, thread.id, "a", "b")
    assert store.fail_turn(db, finished.id, "X") is False
    db.expire_all()
    kept = db.get(AiChatTurn, finished.id)
    assert kept is not None and kept.status == "done"
    running = store.start_turn(db, thread, "c")
    assert store.fail_turn(db, running.id, ErrorId.AI_TURN_LOST.value) is True
    db.expire_all()
    failed = db.get(AiChatTurn, running.id)
    assert failed is not None and failed.status == "failed" and failed.error_id == ErrorId.AI_TURN_LOST.value


def test_replay_carries_done_turns_in_order_without_thinking(db: Session) -> None:
    thread = store.create_thread(db, OWNER)
    first = store.start_turn(db, thread, "one")
    store.finish_turn(
        db,
        first.id,
        status="done",
        blocks=[
            {
                "role": "assistant",
                "content": [
                    {"type": "thinking", "thinking": "", "signature": "sig"},
                    {"type": "tool_use", "id": "t1", "name": "run_query", "input": {}},
                ],
            },
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "{}"}]},
            {"role": "assistant", "content": [{"type": "redacted_thinking", "data": "x"}]},
            {"role": "assistant", "content": [{"type": "text", "text": "answer one"}]},
        ],
        usage=None,
        stop_reason="end_turn",
        error_id=None,
    )
    failed = store.start_turn(db, thread, "broken")
    store.fail_turn(db, failed.id, "X")
    answered(db, thread.id, "two", "answer two")
    current = store.start_turn(db, thread, "three")

    messages, omitted = store.replay(db, thread.id, current.seq, 100_000)

    assert omitted is False
    assert [message["role"] for message in messages] == ["user", "assistant", "user", "assistant", "user", "assistant"]
    assert messages[0]["content"] == [{"type": "text", "text": "one"}]
    assert messages[1]["content"] == [{"type": "tool_use", "id": "t1", "name": "run_query", "input": {}}]
    assert messages[3]["content"][0]["text"] == "answer one"
    assert messages[4]["content"][0]["text"] == "two"
    assert all("broken" not in str(message) for message in messages)


def test_replay_drops_the_oldest_turns_whole_past_the_budget(db: Session) -> None:
    thread = store.create_thread(db, OWNER)
    answered(db, thread.id, "old " + "x" * 500, "old reply")
    answered(db, thread.id, "new", "new reply")
    current = store.start_turn(db, thread, "now")

    messages, omitted = store.replay(db, thread.id, current.seq, 300)

    assert omitted is True
    assert [message["content"][0]["text"] for message in messages] == ["new", "new reply"]


def test_draft_versions_count_up_and_an_unknown_draft_starts_a_new_one(db: Session) -> None:
    thread = store.create_thread(db, OWNER)
    turn = store.start_turn(db, thread, "a")
    draft_id, first = store.save_draft(db, thread.id, turn.id, None, "query", {"v": 1})
    same, second = store.save_draft(db, thread.id, turn.id, draft_id, "query", {"v": 2})
    fresh, fresh_version = store.save_draft(db, thread.id, turn.id, uuid.uuid4(), "query", {"v": 3})
    assert (first, second, fresh_version) == (1, 2, 1)
    assert same == draft_id
    assert fresh != draft_id
    other = store.create_thread(db, OWNER)
    other_turn = store.start_turn(db, other, "b")
    moved, _ = store.save_draft(db, other.id, other_turn.id, draft_id, "query", {"v": 4})
    assert moved != draft_id


def test_promotions_are_recorded_against_an_existing_version(db: Session) -> None:
    thread = store.create_thread(db, OWNER)
    turn = store.start_turn(db, thread, "a")
    draft_id, version = store.save_draft(db, thread.id, turn.id, None, "query", {"name": "q"})
    draft = store.draft_for_owner(db, OWNER, draft_id)
    store.record_promotion(
        db, draft, version=version, target_type="query", target_id="12", target_version_at_promote=3
    )
    with pytest.raises(ApiError) as refused:
        store.record_promotion(
            db, draft, version=9, target_type="query", target_id="12", target_version_at_promote=None
        )
    assert refused.value.status_code == 422

    detail = store.thread_detail(db, OWNER, thread.id)

    assert [one.seq for one in detail["turns"]] == [1]
    [entry] = detail["drafts"]
    assert [one.version for one in entry["versions"]] == [1]
    assert [(one.target_id, one.promoted_version) for one in entry["promotions"]] == [("12", 1)]


def test_deleting_a_thread_takes_its_turns_and_drafts(db: Session) -> None:
    thread = store.create_thread(db, OWNER)
    turn = store.start_turn(db, thread, "a")
    store.save_draft(db, thread.id, turn.id, None, "query", {})
    store.delete_thread(db, OWNER, thread.id)
    db.expire_all()
    assert db.query(AiChatTurn).count() == 0
    assert db.query(AiChatDraft).count() == 0


def test_update_thread_trims_the_title_and_sets_pinned(db: Session) -> None:
    thread = store.create_thread(db, OWNER)
    updated = store.update_thread(db, OWNER, thread.id, title="  " + "y" * 100, pinned=True)
    assert updated.title == "y" * store.TITLE_CHARS
    assert updated.pinned is True
    assert store.update_thread(db, OWNER, thread.id, title=None, pinned=None).title == "y" * store.TITLE_CHARS


def test_replay_skips_a_turn_that_stopped_inside_a_tool_call(db: Session) -> None:
    thread = store.create_thread(db, OWNER)
    stopped = store.start_turn(db, thread, "stopped")
    store.finish_turn(
        db,
        stopped.id,
        status="done",
        blocks=[{"role": "assistant", "content": [{"type": "tool_use", "id": "t", "name": "run_query", "input": {}}]}],
        usage=None,
        stop_reason="cancelled",
        error_id=None,
    )
    answered(db, thread.id, "kept", "kept reply")
    current = store.start_turn(db, thread, "now")

    messages, _ = store.replay(db, thread.id, current.seq, 100_000)

    assert [message["content"][0]["text"] for message in messages] == ["kept", "kept reply"]
