import asyncio
from collections.abc import AsyncIterator

import pytest
from redis.asyncio import Redis

from veodyn_api.services.chat.bus import PendingCall, TurnBus

pytestmark = pytest.mark.anyio

TURN = "turn-1"


@pytest.fixture
async def bus(redis_url: str) -> AsyncIterator[TurnBus]:
    client = Redis.from_url(redis_url)
    yield TurnBus(client)
    await client.aclose()


async def test_frames_read_back_in_order(bus: TurnBus) -> None:
    first = await bus.emit(TURN, "turn_started", {"seq": 1})
    await bus.emit(TURN, "text_delta", {"text": "hi"})
    frames = await bus.read(TURN, None, block_ms=10)
    assert [(event, data) for _, event, data in frames] == [
        ("turn_started", {"seq": 1}),
        ("text_delta", {"text": "hi"}),
    ]
    assert frames[0][0] == first


async def test_reading_after_an_id_returns_only_later_frames(bus: TurnBus) -> None:
    first = await bus.emit(TURN, "a", {})
    await bus.emit(TURN, "b", {})
    assert [event for _, event, _ in await bus.read(TURN, first, block_ms=10)] == ["b"]


async def test_a_read_with_nothing_new_times_out_empty(bus: TurnBus) -> None:
    assert await bus.read(TURN, None, block_ms=20) == []


async def test_a_blocked_read_wakes_on_a_new_frame(bus: TurnBus) -> None:
    reader = asyncio.create_task(bus.read(TURN, None, block_ms=2000))
    await asyncio.sleep(0.05)
    await bus.emit(TURN, "late", {"n": 1})
    assert [event for _, event, _ in await reader] == ["late"]


async def test_a_result_pushed_before_the_wait_is_not_lost(bus: TurnBus) -> None:
    await bus.push_result(TURN, {"callId": "c1", "result": {"ok": True}})
    assert await bus.wait_result(TURN, timeout=1) == {"callId": "c1", "result": {"ok": True}}


async def test_waiting_for_a_result_times_out(bus: TurnBus) -> None:
    assert await bus.wait_result(TURN, timeout=0.1) is None


async def test_pending_call_round_trip(bus: TurnBus) -> None:
    assert await bus.pending(TURN) is None
    await bus.set_pending(TURN, "c1", "search_library")
    assert await bus.pending(TURN) == PendingCall(call_id="c1", tool="search_library")
    await bus.clear_pending(TURN)
    assert await bus.pending(TURN) is None


async def test_the_lease_is_alive_until_released(bus: TurnBus) -> None:
    assert await bus.lease_alive(TURN) is False
    await bus.hold_lease(TURN)
    assert await bus.lease_alive(TURN) is True
    await bus.release_lease(TURN)
    assert await bus.lease_alive(TURN) is False


async def test_cancel_is_requested_once_set(bus: TurnBus) -> None:
    assert await bus.cancel_requested(TURN) is False
    await bus.request_cancel(TURN)
    assert await bus.cancel_requested(TURN) is True


async def test_sealing_puts_an_expiry_on_the_frame_log(bus: TurnBus, redis_url: str) -> None:
    await bus.emit(TURN, "turn_done", {})
    await bus.seal(TURN)
    client = Redis.from_url(redis_url)
    try:
        ttl = await client.ttl(f"chat:turn:{TURN}:frames")
    finally:
        await client.aclose()
    assert 0 < ttl <= 3600
