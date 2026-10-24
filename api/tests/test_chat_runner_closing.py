import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import pytest
from redis.asyncio import Redis
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from tests.chat_stubs import ScriptedChatModel, text_turn, tool_turn
from tests.test_chat_runner import RESULT, RUN, frames, make_runner, new_turn, stored
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.services.chat import closing
from veodyn_api.services.chat import runner as runner_module
from veodyn_api.services.chat.bus import TurnBus
from veodyn_api.services.chat.driver import ModelTurn

pytestmark = pytest.mark.anyio

BAD = dict(RUN, datasetTable="nowhere")


@pytest.fixture
async def bus(redis_url: str) -> AsyncIterator[TurnBus]:
    client = Redis.from_url(redis_url)
    yield TurnBus(client)
    await client.aclose()


@pytest.fixture
def sessions(engine: Engine, db: Session) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)


def two_calls() -> ModelTurn:
    first = tool_turn("a", "run_query", RUN)
    second = tool_turn("b", "run_query", RUN)
    return ModelTurn(
        content=[first.content[0], first.content[-1], second.content[-1]],
        stop_reason="tool_use",
        usage=first.usage,
    )


def tool_pairs(messages: list[dict[str, Any]]) -> tuple[set[str], set[str]]:
    used: set[str] = set()
    answered: set[str] = set()
    for message in messages:
        for block in message["content"]:
            if block.get("type") == "tool_use":
                used.add(block["id"])
            if block.get("type") == "tool_result":
                answered.add(block["tool_use_id"])
    return used, answered


def test_the_ceiling_is_thirty_steps() -> None:
    assert runner_module.MAX_TOOL_HOPS == 30


async def test_hop_ceiling_ends_with_a_model_written_answer(db: Session, bus: TurnBus, sessions: Any) -> None:
    turn = new_turn(db)
    scripted = [tool_turn(f"c{index}", "run_query", BAD) for index in range(30)]
    model = ScriptedChatModel(*scripted, text_turn("Here is what I found."))
    await make_runner(model, bus, sessions).run(turn.id, turn.thread_id, 1, turn.user_text)
    events = await frames(bus, turn)
    assert events[-1][0] == "turn_done"
    assert events[-1][1]["stopReason"] == "end_turn"
    assert len(model.calls) == 31
    assert model.calls[-1]["forbid_tools"] is True
    last = stored(db, turn).blocks[-1]
    assert last["content"][0]["text"] == "Here is what I found."
    assert not hasattr(runner_module, "HOP_LIMIT_TEXT")
    used, answered = tool_pairs(model.calls[-1]["messages"])
    assert used == answered


async def test_clock_reserve_triggers_closing_call(
    db: Session, bus: TurnBus, sessions: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = {"now": 0.0}
    monkeypatch.setattr(runner_module, "_monotonic", lambda: clock["now"])
    turn = new_turn(db)
    model = ScriptedChatModel(two_calls(), text_turn("Partial answer."))
    run = asyncio.create_task(make_runner(model, bus, sessions).run(turn.id, turn.thread_id, 1, turn.user_text))
    after: str | None = None
    answered = False
    while not answered:
        for frame_id, event, data in await bus.read(str(turn.id), after, block_ms=500):
            after = frame_id
            if event == "tool_request":
                await bus.push_result(str(turn.id), {"callId": data["callId"], "result": dict(RESULT)})
                clock["now"] = runner_module.TURN_SECONDS - 1
                answered = True
    await asyncio.wait_for(run, 10)
    events = await frames(bus, turn)
    assert events[-1][0] == "turn_done"
    assert stored(db, turn).status == "done"
    used, replied = tool_pairs(model.calls[-1]["messages"])
    assert used == {"a", "b"} == replied
    results = model.calls[-1]["messages"][2]["content"]
    pending = next(item for item in results if item["tool_use_id"] == "b")
    assert json.loads(pending["content"])["ok"] is False
    assert [event for event, _ in events].count("tool_request") == 1


async def test_cancel_skips_closing_call(db: Session, bus: TurnBus, sessions: Any) -> None:
    turn = new_turn(db)
    model = ScriptedChatModel(tool_turn("c1", "run_query", RUN))
    run = asyncio.create_task(make_runner(model, bus, sessions).run(turn.id, turn.thread_id, 1, turn.user_text))
    while "tool_request" not in [event for event, _ in await frames(bus, turn)]:
        await asyncio.sleep(0.02)
    await bus.request_cancel(str(turn.id))
    await asyncio.wait_for(run, 5)
    assert (await frames(bus, turn))[-1][1]["stopReason"] == "cancelled"
    assert len(model.calls) == 1


async def test_closing_call_provider_failure_records_failed_turn(
    db: Session, bus: TurnBus, sessions: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(runner_module, "MAX_TOOL_HOPS", 1)
    turn = new_turn(db)
    failure = ApiError(ErrorId.AI_PROVIDER_FAILED, "the model provider returned 529", 502)
    model = ScriptedChatModel(tool_turn("c1", "run_query", BAD), failure)
    await make_runner(model, bus, sessions).run(turn.id, turn.thread_id, 1, turn.user_text)
    assert (await frames(bus, turn))[-1][1]["id"] == ErrorId.AI_PROVIDER_FAILED.value
    assert stored(db, turn).status == "failed"


def pair(call_id: str, body: str) -> list[dict[str, Any]]:
    return [
        {"role": "assistant", "content": [{"type": "tool_use", "id": call_id, "name": "x", "input": {}}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": call_id, "content": body}]},
    ]


def result_bodies(messages: list[dict[str, Any]]) -> dict[str, str]:
    return {
        item["tool_use_id"]: item["content"]
        for message in messages
        if message["role"] == "user"
        for item in message["content"]
    }


def test_bounded_turn_blocks_keeps_pairs_and_latest_result() -> None:
    blocks = [*pair("a", "A" * 5_000), *pair("b", "B" * 5_000), *pair("c", "C" * 5_000)]
    bounded = closing.bounded_turn_blocks(blocks, 6_000)
    used, answered = tool_pairs(bounded)
    assert used == answered == {"a", "b", "c"}
    bodies = result_bodies(bounded)
    assert bodies["c"] == "C" * 5_000
    assert len(bodies["a"]) < 5_000
    assert len(bodies["b"]) < 5_000
    assert result_bodies(blocks)["a"] == "A" * 5_000


def test_bounded_turn_blocks_leaves_a_small_turn_whole() -> None:
    blocks = [*pair("a", "A" * 100), *pair("b", "B" * 100)]
    assert closing.bounded_turn_blocks(blocks, 6_000) == blocks


def test_settle_pending_adds_a_result_for_each_id() -> None:
    blocks: list[dict[str, Any]] = []
    closing.settle_pending(blocks, ["x", "y"])
    [message] = blocks
    assert message["role"] == "user"
    assert [item["tool_use_id"] for item in message["content"]] == ["x", "y"]
    assert json.loads(message["content"][0]["content"]) == {"ok": False, "error": "not finished before the turn ended"}
    assert message["content"][0]["is_error"] is True


async def test_a_batch_that_is_entirely_settled_has_one_results_message(
    db: Session, bus: TurnBus, sessions: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = {"now": 0.0}
    monkeypatch.setattr(runner_module, "_monotonic", lambda: clock["now"])

    async def late_batch() -> ModelTurn:
        clock["now"] = runner_module.TURN_SECONDS - 1
        return two_calls()

    turn = new_turn(db)
    model = ScriptedChatModel(late_batch, text_turn("Closing answer."))
    await make_runner(model, bus, sessions).run(turn.id, turn.thread_id, 1, turn.user_text)
    assert stored(db, turn).status == "done"
    messages = model.calls[-1]["messages"]
    assert all(message["content"] for message in messages)
    assert [message["role"] for message in messages] == ["user", "assistant", "user"]
    assert [item["tool_use_id"] for item in messages[2]["content"]] == ["a", "b"]
