import json
from functools import lru_cache
from typing import Any, cast

from redis.asyncio import Redis

from veodyn_api.settings import get_settings

FRAME_LOG_MAXLEN = 5000
FRAME_LOG_TTL_SECONDS = 3600
LEASE_TTL_SECONDS = 20
KEY_TTL_SECONDS = 3600


def _key(turn_id: str, part: str) -> str:
    return f"chat:turn:{turn_id}:{part}"


def _text(value: Any) -> str:
    return value.decode() if isinstance(value, bytes) else str(value)


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

    async def set_pending(self, turn_id: str, call_id: str) -> None:
        await self._redis.set(_key(turn_id, "pending"), call_id, ex=KEY_TTL_SECONDS)

    async def pending(self, turn_id: str) -> str | None:
        value = await self._redis.get(_key(turn_id, "pending"))
        return None if value is None else _text(value)

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
    return Redis.from_url(get_settings().redis_url)
