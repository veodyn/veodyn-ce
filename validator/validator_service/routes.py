"""The two HTTP endpoints this service exposes. See README.md for the contract.

Both blocking calls (`cache.get_prepared`, which may run a ~48 second prepare,
and `run_validation`, which decodes and validates) go through
`run_in_threadpool` rather than being awaited directly: neither the cached
package nor the validator underneath it is async, and calling either inline
would block the event loop for every other request the whole time.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse
from gtfs_rt_validator.api import PreparedFeed
from starlette.concurrency import run_in_threadpool

from validator_service.cache import PreparedFeedCache, PrepareInProgress
from validator_service.dependencies import get_cache
from validator_service.fetch import StaticFetchError
from validator_service.validation import FeedDecodeError, run_validation

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/validate")
async def validate_feed(
    feed: Annotated[UploadFile, File()],
    gtfs: Annotated[str, Form()],
    cache: Annotated[PreparedFeedCache[PreparedFeed], Depends(get_cache)],
    previous: Annotated[UploadFile | None, File()] = None,
) -> JSONResponse:
    gtfs_url = gtfs.strip()
    if not gtfs_url:
        return _error(400, "the gtfs form field is required")

    feed_bytes = await feed.read()
    if not feed_bytes:
        return _error(400, "feed must not be empty")

    previous_bytes: bytes | None = None
    if previous is not None:
        read = await previous.read()
        previous_bytes = read or None

    try:
        prepared = await run_in_threadpool(cache.get_prepared, gtfs_url)
    except PrepareInProgress:
        return _error(503, f"a prepare for {gtfs_url!r} is already in flight; retry shortly")
    except StaticFetchError as exc:
        return _error(502, str(exc))

    try:
        report = await run_in_threadpool(run_validation, prepared, feed_bytes, previous_bytes)
    except FeedDecodeError as exc:
        return _error(400, str(exc))

    return JSONResponse(status_code=200, content=report)


def _error(status_code: int, message: str) -> JSONResponse:
    content: dict[str, Any] = {"error": message}
    return JSONResponse(status_code=status_code, content=content)
