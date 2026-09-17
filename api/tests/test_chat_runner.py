import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import pytest
from redis.asyncio import Redis
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from tests.chat_stubs import ScriptedChatModel, text_turn, tool_turn
from tests.converse_stubs import SPEEDS
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.models.ai_chat import AiChatTurn
from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.services.chat import runner as runner_module
from veodyn_api.services.chat import store
from veodyn_api.services.chat.bus import TurnBus
from veodyn_api.services.chat.driver import ModelTurn
from veodyn_api.services.chat.runner import TurnRunner

pytestmark = pytest.mark.anyio

OWNER = "7"
SQL = "SELECT avg(speed_mph) FROM regional_speeds"
RUN = {"datasetTable": "regional_speeds", "sql": SQL, "purpose": "average", "vizChoiceId": "counter"}
RESULT = {"ok": True, "rowCount": 1, "truncated": False, "columns": [], "sample": [{"avg": 31.5}]}


@pytest.fixture
async def bus(redis_url: str) -> AsyncIterator[TurnBus]:
    client = Redis.from_url(redis_url)
    yield TurnBus(client)
    await client.aclose()


@pytest.fixture
def sessions(engine: Engine, db: Session) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)


def make_runner(model: ScriptedChatModel, bus: TurnBus, sessions: sessionmaker[Session]) -> TurnRunner:
    async def datasets() -> tuple[DatasetOut, ...]:
        return (SPEEDS,)

    async def data_source_id() -> int:
        return 5

    return TurnRunner(model=model, bus=bus, sessions=sessions, datasets=datasets, data_source_id=data_source_id)


def new_turn(db: Session, text: str = "how fast?") -> AiChatTurn:
    thread = store.create_thread(db, OWNER)
    return store.start_turn(db, thread, text)


async def frames(bus: TurnBus, turn: AiChatTurn) -> list[tuple[str, dict[str, Any]]]:
    return [(event, data) for _, event, data in await bus.read(str(turn.id), None, block_ms=10)]


def stored(db: Session, turn: AiChatTurn) -> AiChatTurn:
    db.expire_all()
    found = db.get(AiChatTurn, turn.id)
    assert found is not None
    return found


async def browser(bus: TurnBus, turn: AiChatTurn, results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: list[dict[str, Any]] = []
    after: str | None = None
    while results:
        for frame_id, event, data in await bus.read(str(turn.id), after, block_ms=500):
            after = frame_id
            if event == "tool_request":
                seen.append(data)
                await bus.push_result(str(turn.id), {"callId": data["callId"], "result": results.pop(0)})
            if event in ("turn_done", "error"):
                return seen
    return seen


async def test_a_text_only_turn_streams_and_is_stored(db: Session, bus: TurnBus, sessions: Any) -> None:
    turn = new_turn(db)
    model = ScriptedChatModel(text_turn("About 31 mph."))

    await make_runner(model, bus, sessions).run(turn.id, turn.thread_id, turn.seq, turn.user_text)

    events = await frames(bus, turn)
    assert events[0] == ("turn_started", {"turnId": str(turn.id), "seq": 1})
    assert ("text_delta", {"text": "About 31 mph."}) in events
    assert events[-1][0] == "turn_done"
    assert events[-1][1]["stopReason"] == "end_turn"
    assert events[-1][1]["usage"]["model"] == "scripted-model"
    done = stored(db, turn)
    assert done.status == "done"
    assert done.blocks == [{"role": "assistant", "content": [{"type": "text", "text": "About 31 mph."}]}]
    assert done.usage == {"input_tokens": 3, "output_tokens": 5, "model": "scripted-model"}
    assert not await bus.lease_alive(str(turn.id))
    assert model.calls[0]["messages"] == [{"role": "user", "content": [{"type": "text", "text": "how fast?"}]}]
    assert [tool["name"] for tool in model.calls[0]["tools"]] == ["run_query", "propose_query"]


async def test_a_query_round_trips_through_the_browser(db: Session, bus: TurnBus, sessions: Any) -> None:
    turn = new_turn(db)
    first = tool_turn("call-1", "run_query", RUN, text="Let me check.")
    model = ScriptedChatModel(first, text_turn("It is 31.5 mph."))
    run = asyncio.create_task(make_runner(model, bus, sessions).run(turn.id, turn.thread_id, 1, turn.user_text))

    requests = await browser(bus, turn, [dict(RESULT)])
    await run

    assert requests == [
        {
            "callId": "call-1",
            "tool": "run_query",
            "args": {"dataSourceId": 5, "sql": SQL, "purpose": "average", "vizChoiceId": "counter"},
        }
    ]
    events = await frames(bus, turn)
    names = [event for event, _ in events]
    assert names.index("tool_request") < names.index("tool_settled") < names.index("turn_done")
    settled = next(data for event, data in events if event == "tool_settled")
    assert settled["ok"] is True and settled["rowCount"] == 1
    assert ("status", {"phase": "waiting_for_browser"}) in events
    second = model.calls[1]["messages"]
    assert second[1] == {"role": "assistant", "content": first.content}
    assert second[1]["content"][0]["signature"] == "sig-call-1"
    [result] = second[2]["content"]
    assert result["type"] == "tool_result" and result["tool_use_id"] == "call-1"
    assert json.loads(result["content"]) == RESULT
    assert "is_error" not in result
    assert [message["role"] for message in stored(db, turn).blocks] == ["assistant", "user", "assistant"]


async def test_a_failed_run_is_an_error_result(db: Session, bus: TurnBus, sessions: Any) -> None:
    turn = new_turn(db)
    model = ScriptedChatModel(tool_turn("c1", "run_query", RUN), text_turn("That failed."))
    run = asyncio.create_task(make_runner(model, bus, sessions).run(turn.id, turn.thread_id, 1, turn.user_text))
    await browser(bus, turn, [{"ok": False, "error": "Code: 60. Unknown table"}])
    await run
    [result] = model.calls[1]["messages"][2]["content"]
    assert result["is_error"] is True
    assert "Unknown table" in result["content"]


async def test_a_result_for_another_call_is_ignored(db: Session, bus: TurnBus, sessions: Any) -> None:
    turn = new_turn(db)
    model = ScriptedChatModel(tool_turn("c1", "run_query", RUN), text_turn("ok"))
    await bus.push_result(str(turn.id), {"callId": "someone-else", "result": {"ok": False}})
    run = asyncio.create_task(make_runner(model, bus, sessions).run(turn.id, turn.thread_id, 1, turn.user_text))
    await browser(bus, turn, [dict(RESULT)])
    await run
    assert json.loads(model.calls[1]["messages"][2]["content"][0]["content"]) == RESULT


async def test_no_result_in_time_tells_the_model(
    db: Session, bus: TurnBus, sessions: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(runner_module, "TOOL_WAIT_SECONDS", 0.2)
    monkeypatch.setattr(runner_module, "TOOL_WAIT_SLICE_SECONDS", 0.1)
    turn = new_turn(db)
    model = ScriptedChatModel(tool_turn("c1", "run_query", RUN), text_turn("I could not get a result."))
    await make_runner(model, bus, sessions).run(turn.id, turn.thread_id, 1, turn.user_text)
    [result] = model.calls[1]["messages"][2]["content"]
    assert result["is_error"] is True
    assert json.loads(result["content"]) == runner_module.TIMED_OUT_RESULT
    assert await bus.pending(str(turn.id)) is None


async def test_refused_sql_goes_back_to_the_model_without_a_browser_request(
    db: Session, bus: TurnBus, sessions: Any
) -> None:
    turn = new_turn(db)
    bad = dict(RUN, sql="DROP TABLE regional_speeds")
    model = ScriptedChatModel(tool_turn("c1", "run_query", bad), text_turn("I cannot do that."))
    await make_runner(model, bus, sessions).run(turn.id, turn.thread_id, 1, turn.user_text)
    assert "tool_request" not in [event for event, _ in await frames(bus, turn)]
    [result] = model.calls[1]["messages"][2]["content"]
    assert result["is_error"] is True and "DROP" in result["content"]


async def test_a_proposal_emits_a_draft_and_stores_it(db: Session, bus: TurnBus, sessions: Any) -> None:
    turn = new_turn(db)
    proposal = dict(name="Average speed", datasetTable="regional_speeds", sql=SQL, vizChoiceId="counter")
    model = ScriptedChatModel(tool_turn("c1", "propose_query", proposal), text_turn("Here it is."))
    await make_runner(model, bus, sessions).run(turn.id, turn.thread_id, 1, turn.user_text)
    [draft] = [data for event, data in await frames(bus, turn) if event == "draft"]
    assert draft["version"] == 1 and draft["kind"] == "query"
    assert draft["payload"]["sql"] == SQL
    detail = store.thread_detail(db, OWNER, turn.thread_id)
    assert str(detail["drafts"][0]["draft"].id) == draft["draftId"]


async def test_the_hop_limit_ends_the_turn_with_a_note(
    db: Session, bus: TurnBus, sessions: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(runner_module, "MAX_TOOL_HOPS", 2)
    turn = new_turn(db)
    bad = dict(RUN, datasetTable="nowhere")
    model = ScriptedChatModel(tool_turn("c1", "run_query", bad), tool_turn("c2", "run_query", bad))
    await make_runner(model, bus, sessions).run(turn.id, turn.thread_id, 1, turn.user_text)
    events = await frames(bus, turn)
    assert events[-1] == (
        "turn_done",
        {"stopReason": "tool_hop_limit", "usage": {"input_tokens": 6, "output_tokens": 10, "model": "scripted-model"}},
    )
    assert ("text_delta", {"text": runner_module.HOP_LIMIT_TEXT}) in events
    assert stored(db, turn).blocks[-1]["content"][0]["text"] == runner_module.HOP_LIMIT_TEXT


async def test_cancel_stops_before_the_next_step(db: Session, bus: TurnBus, sessions: Any) -> None:
    turn = new_turn(db)
    model = ScriptedChatModel(tool_turn("c1", "run_query", RUN))
    run = asyncio.create_task(make_runner(model, bus, sessions).run(turn.id, turn.thread_id, 1, turn.user_text))
    while "tool_request" not in [event for event, _ in await frames(bus, turn)]:
        await asyncio.sleep(0.02)
    await bus.request_cancel(str(turn.id))
    await asyncio.wait_for(run, 5)
    assert (await frames(bus, turn))[-1][1]["stopReason"] == "cancelled"
    assert len(model.calls) == 1
    assert stored(db, turn).status == "done"


async def test_a_provider_failure_fails_the_turn(db: Session, bus: TurnBus, sessions: Any) -> None:
    turn = new_turn(db)
    model = ScriptedChatModel(ApiError(ErrorId.AI_PROVIDER_FAILED, "the model provider returned 529", 502))
    await make_runner(model, bus, sessions).run(turn.id, turn.thread_id, 1, turn.user_text)
    assert (await frames(bus, turn))[-1] == (
        "error",
        {"id": ErrorId.AI_PROVIDER_FAILED.value, "message": "the model provider returned 529"},
    )
    failed = stored(db, turn)
    assert failed.status == "failed" and failed.error_id == ErrorId.AI_PROVIDER_FAILED.value
    assert not await bus.lease_alive(str(turn.id))


async def test_an_unexpected_error_fails_the_turn_without_detail(db: Session, bus: TurnBus, sessions: Any) -> None:
    turn = new_turn(db)
    await make_runner(ScriptedChatModel(RuntimeError("secret detail")), bus, sessions).run(
        turn.id, turn.thread_id, 1, turn.user_text
    )
    event, data = (await frames(bus, turn))[-1]
    assert event == "error" and "secret" not in data["message"]
    assert stored(db, turn).error_id == ErrorId.INTERNAL_ERROR.value


async def test_a_slow_turn_times_out(
    db: Session, bus: TurnBus, sessions: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(runner_module, "TURN_SECONDS", 0.1)
    turn = new_turn(db)

    async def slow() -> ModelTurn:
        await asyncio.sleep(1)
        return text_turn("late")

    await make_runner(ScriptedChatModel(slow), bus, sessions).run(turn.id, turn.thread_id, 1, turn.user_text)
    assert (await frames(bus, turn))[-1][1]["id"] == ErrorId.AI_TURN_TIMEOUT.value
    assert stored(db, turn).status == "failed"


async def test_a_refusal_ends_the_turn_with_a_plain_message(db: Session, bus: TurnBus, sessions: Any) -> None:
    turn = new_turn(db)
    refused = ModelTurn(content=[], stop_reason="refusal", usage={})
    await make_runner(ScriptedChatModel(refused), bus, sessions).run(turn.id, turn.thread_id, 1, turn.user_text)
    events = await frames(bus, turn)
    assert ("text_delta", {"text": runner_module.REFUSAL_TEXT}) in events
    assert events[-1][1]["stopReason"] == "refusal"
    assert "draft" not in [event for event, _ in events]


async def test_earlier_turns_are_replayed(db: Session, bus: TurnBus, sessions: Any) -> None:
    earlier = new_turn(db, "first question")
    await make_runner(ScriptedChatModel(text_turn("first answer")), bus, sessions).run(
        earlier.id, earlier.thread_id, 1, earlier.user_text
    )
    thread = store.thread_for_owner(db, OWNER, earlier.thread_id)
    later = store.start_turn(db, thread, "second question")
    model = ScriptedChatModel(text_turn("second answer"))
    await make_runner(model, bus, sessions).run(later.id, later.thread_id, later.seq, later.user_text)
    assert [message["content"][0]["text"] for message in model.calls[0]["messages"]] == [
        "first question",
        "first answer",
        "second question",
    ]


async def test_spawned_turns_are_kept_until_they_finish(db: Session, bus: TurnBus, sessions: Any) -> None:
    turn = new_turn(db)
    task = runner_module.spawn_turn(
        make_runner(ScriptedChatModel(text_turn("hi")), bus, sessions), turn.id, turn.thread_id, 1, "x"
    )
    assert task in runner_module._RUNNING
    await task
    await asyncio.sleep(0)
    assert task not in runner_module._RUNNING
