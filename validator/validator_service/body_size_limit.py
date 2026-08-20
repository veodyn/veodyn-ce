"""ASGI middleware rejecting an oversized request body before the app parses it.

FastAPI's multipart parser spools the whole upload to a `SpooledTemporaryFile`
before any route handler runs (confirmed by probing: a 10-byte cap and a
2 MiB part still landed the complete part on disk before a handler-level
check like `archive_limits.write_capped` ever ran), so a per-route check only
bounds memory and disk use once the body has already been fully received.
This middleware counts body bytes as they arrive off the ASGI `receive`
callable, ahead of that parsing, and answers 413 once a request exceeds the
configured cap, without waiting for the rest of the body to arrive.

Applied app-wide (`main.py`), not just to `/validate-static`: `/validate`
reads its own realtime upload fully with `feed.read()` and has the identical
exposure, so one middleware covers both. The route-level checks
(`archive_limits.write_capped`, `fetch.download`'s counter) stay in place as
defense in depth and as the source of the specific 400/502 error messages;
this middleware's 413 is the backstop that guarantees a bound even before a
route runs at all.

Raising `starlette.exceptions.HTTPException` rather than a plain exception is
load-bearing, not stylistic: FastAPI's own request-body handling
(`fastapi.routing`) wraps any exception raised while reading the body in a
blanket `except Exception: raise HTTPException(400, "...")`, but explicitly
re-raises an `HTTPException` unchanged first. A plain exception here would
therefore surface as a misleading 400 instead of this middleware's 413.
"""

from __future__ import annotations

from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class MaxBodySizeMiddleware:
    """Rejects a request whose body exceeds `max_bytes` (plus `overhead_bytes`
    of slack for multipart boundaries and field headers, which ride along
    with the file content) with a 413.
    """

    def __init__(self, app: ASGIApp, *, max_bytes: int, overhead_bytes: int = 65_536) -> None:
        self.app = app
        self.limit = max_bytes + overhead_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        received = 0

        async def counting_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body") or b"")
                if received > self.limit:
                    raise HTTPException(status_code=413, detail="request body too large")
            return message

        await self.app(scope, counting_receive, send)
