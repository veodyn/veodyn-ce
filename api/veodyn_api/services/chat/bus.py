import json
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, cast

from redis.asyncio import Redis
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError

from veodyn_api.settings import get_settings

FRAME_LOG_MAXLEN = 5000
FRAME_LOG_TTL_SECONDS = 3600
LEASE_TTL_SECONDS = 20
KEY_TTL_SECONDS = 3600
# A stream_turn GET blocks on bus.read() for up to STREAM_BLOCK_MS (5s) at a
# time and can sit in that loop for as long as the turn runs, so an idle
# connection in the pool needs to be checked well inside a single turn rather
# than only rediscovered the next time something reaches for it.
REDIS_HEALTH_CHECK_INTERVAL_SECONDS = 15


def _key(turn_id: str, part: str) -> str:
    return f"chat:turn:{turn_id}:{part}"


def _text(value: Any) -> str:
    return value.decode() if isinstance(value, bytes) else str(value)


@dataclass(frozen=True)
class PendingCall:
    call_id: str
    tool: str


class TurnBus:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def emit(self, turn_id: str, event: str, data: dict[str, Any]) -> str:
        entry = {"event": event, "data": json.dumps(data, separators=(",", ":"))}
        frame_id = await self._redis.xadd(
            _key(turn_id, "frames"), cast(Any, entry), maxlen=FRAME_LOG_MAXLEN, approximate=True
        )
        return _text(frame_id)

    async def read(self, turn_id: str, after: str | None, block_ms: int) -> list[tuple[str, str, dict[str, Any]]]:
        response: Any = await self._redis.xread({_key(turn_id, "frames"): after or "0-0"}, block=block_ms)
        frames: list[tuple[str, str, dict[str, Any]]] = []
        for _stream, entries in response or []:
            for frame_id, fields in cast(list[tuple[Any, dict[Any, Any]]], entries):
                decoded = {_text(key): _text(value) for key, value in fields.items()}
                frames.append((_text(frame_id), decoded["event"], json.loads(decoded["data"])))
        return frames

    async def seal(self, turn_id: str) -> None:
        await self._redis.expire(_key(turn_id, "frames"), FRAME_LOG_TTL_SECONDS)

    async def last_id(self, turn_id: str) -> str | None:
        entries = await self._redis.xrevrange(_key(turn_id, "frames"), count=1)
        if not entries:
            return None
        return _text(entries[0][0])

    async def set_pending(self, turn_id: str, call_id: str, tool: str) -> None:
        value = json.dumps({"callId": call_id, "tool": tool}, separators=(",", ":"))
        await self._redis.set(_key(turn_id, "pending"), value, ex=KEY_TTL_SECONDS)

    async def pending(self, turn_id: str) -> PendingCall | None:
        value = await self._redis.get(_key(turn_id, "pending"))
        if value is None:
            return None
        decoded = json.loads(_text(value))
        return PendingCall(call_id=str(decoded["callId"]), tool=str(decoded["tool"]))

    async def clear_pending(self, turn_id: str) -> None:
        await self._redis.delete(_key(turn_id, "pending"))

    async def push_result(self, turn_id: str, payload: dict[str, Any]) -> None:
        key = _key(turn_id, "results")
        await self._redis.rpush(key, json.dumps(payload, separators=(",", ":")))
        await self._redis.expire(key, KEY_TTL_SECONDS)

    async def wait_result(self, turn_id: str, timeout: float) -> dict[str, Any] | None:
        if timeout <= 0:
            return None
        popped = await self._redis.blpop([_key(turn_id, "results")], timeout=timeout)
        if popped is None:
            return None
        value = json.loads(_text(popped[1]))
        return value if isinstance(value, dict) else None

    async def hold_lease(self, turn_id: str) -> None:
        await self._redis.set(_key(turn_id, "lease"), "1", ex=LEASE_TTL_SECONDS)

    async def lease_alive(self, turn_id: str) -> bool:
        return bool(await self._redis.exists(_key(turn_id, "lease")))

    async def release_lease(self, turn_id: str) -> None:
        await self._redis.delete(_key(turn_id, "lease"))

    async def request_cancel(self, turn_id: str) -> None:
        await self._redis.set(_key(turn_id, "cancel"), "1", ex=KEY_TTL_SECONDS)

    async def cancel_requested(self, turn_id: str) -> bool:
        return bool(await self._redis.exists(_key(turn_id, "cancel")))


@lru_cache
def get_redis() -> Redis:
    # redis-py builds a client with retry logic already attached (10 attempts,
    # exponential backoff) but leaves it OFF by default: retry_on_timeout is
    # False and retry_on_error is empty, so a connection blip that used to work
    # fine as a plain drop-and-reconnect-next-time now surfaces as a live
    # RedisError straight out of stream_turn's read loop, which is what
    # produces the "Chat is unavailable" frame on an otherwise healthy turn.
    # Turning both on lets the client retry the one call transparently instead
    # of every blip becoming a turn failure.
    return Redis.from_url(
        get_settings().redis_url,
        retry_on_timeout=True,
        retry_on_error=[RedisConnectionError, RedisTimeoutError],
        health_check_interval=REDIS_HEALTH_CHECK_INTERVAL_SECONDS,
    )
