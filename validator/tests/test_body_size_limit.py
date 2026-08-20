"""Unit tests for `MaxBodySizeMiddleware`, driven by a hand-built `receive`
stub that yields the body one chunk at a time and counts how many times it
was actually called. This is what proves the middleware stops early: a test
that only checks the final response status would still pass if the
middleware read every chunk before rejecting, which is exactly the failure
mode a handler-level check alone already had (see archive_limits.py's
history: `write_capped` bounds memory only after the multipart parser has
already spooled the whole part to disk).
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from starlette.exceptions import HTTPException

from validator_service.body_size_limit import MaxBodySizeMiddleware


def _http_scope() -> dict[str, Any]:
    return {"type": "http", "method": "POST", "path": "/x", "headers": []}


def _chunked(total_bytes: int, chunk_size: int) -> list[bytes]:
    remaining = total_bytes
    chunks = []
    while remaining > 0:
        size = min(chunk_size, remaining)
        chunks.append(b"x" * size)
        remaining -= size
    return chunks


class _ChunkedReceive:
    """Delivers `chunks` one `http.request` message at a time, `more_body`
    True until the last one, and counts how many times it was called."""

    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = list(chunks)
        self.calls = 0

    async def __call__(self) -> dict[str, Any]:
        self.calls += 1
        if not self._chunks:
            return {"type": "http.request", "body": b"", "more_body": False}
        chunk = self._chunks.pop(0)
        return {"type": "http.request", "body": chunk, "more_body": bool(self._chunks)}


async def _drain(scope: dict[str, Any], receive: Any, send: Any) -> None:
    """A downstream app standing in for starlette's own body/multipart
    reading: calls `receive()` until told there is no more body, exactly the
    loop `MultiPartParser.parse` runs (`async for chunk in self.stream`)."""
    while True:
        message = await receive()
        if not message.get("more_body", False):
            break


def _run(coro: Any) -> None:
    asyncio.run(coro)


async def _unused_send(message: dict[str, Any]) -> None:
    raise AssertionError("the middleware itself never sends a response; HTTPException propagates")


def test_oversized_body_is_rejected_before_every_chunk_is_read() -> None:
    """The middleware raises `HTTPException`, not a plain exception (see the
    module docstring for why): FastAPI's own body-reading code re-raises an
    HTTPException unchanged but wraps anything else into a misleading 400."""
    total_chunks = 10
    receive = _ChunkedReceive(_chunked(total_bytes=1_000_000, chunk_size=100_000))
    middleware = MaxBodySizeMiddleware(_drain, max_bytes=10, overhead_bytes=0)

    with pytest.raises(HTTPException) as exc_info:
        _run(middleware(_http_scope(), receive, _unused_send))

    assert exc_info.value.status_code == 413
    assert receive.calls < total_chunks, "must reject before every chunk is consumed"


def test_body_within_the_limit_reaches_the_app_unmodified() -> None:
    receive = _ChunkedReceive(_chunked(total_bytes=500, chunk_size=100))
    reached_app: dict[str, Any] = {}

    async def app(scope: dict[str, Any], receive_inner: Any, send: Any) -> None:
        total = 0
        while True:
            message = await receive_inner()
            total += len(message.get("body", b""))
            if not message.get("more_body", False):
                break
        reached_app["total"] = total
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    sent: list[dict[str, Any]] = []

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    middleware = MaxBodySizeMiddleware(app, max_bytes=10_000, overhead_bytes=0)

    _run(middleware(_http_scope(), receive, send))

    assert reached_app["total"] == 500
    status = next(m["status"] for m in sent if m["type"] == "http.response.start")
    assert status == 200


def test_non_http_scope_passes_through_untouched() -> None:
    calls: list[str] = []

    async def app(scope: dict[str, Any], receive: Any, send: Any) -> None:
        calls.append(scope["type"])

    async def receive() -> dict[str, Any]:
        raise AssertionError("must not be called for a non-http scope")

    middleware = MaxBodySizeMiddleware(app, max_bytes=1)

    _run(middleware({"type": "lifespan"}, receive, _unused_send))

    assert calls == ["lifespan"]
