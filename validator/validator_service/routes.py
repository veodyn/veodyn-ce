"""The three HTTP endpoints this service exposes. See README.md for the contract.

Every blocking call (`cache.get_prepared`, which may run a ~48 second prepare;
`run_validation`, which decodes and validates a realtime message; `download`,
`write_capped`, `check_uncompressed_size` and `validate_static_archive`, which
fetch, cap and walk a static archive) goes through `run_in_threadpool` rather
than being awaited directly: neither the cached package nor the validators
underneath them are async, and calling any of them inline would block the
event loop for every other request the whole time.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response
from gtfs_rt_validator.api import PreparedFeed
from gtfs_validator.report import dumps_json
from starlette.concurrency import run_in_threadpool

from validator_service.archive_limits import ArchiveTooLarge, check_uncompressed_size, write_capped
from validator_service.cache import PreparedFeedCache, PrepareInProgress
from validator_service.dependencies import StaticLimits, get_cache, get_static_limits
from validator_service.fetch import StaticFetchError, download
from validator_service.static_validation import validate_static_archive
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


@router.post("/validate-static")
async def validate_static(
    limits: Annotated[StaticLimits, Depends(get_static_limits)],
    archive: Annotated[UploadFile | None, File()] = None,
    gtfs: Annotated[str | None, Form()] = None,
) -> Response:
    gtfs_url = gtfs.strip() if gtfs is not None else ""
    # An empty upload counts as absent, the same as a blank gtfs field: a
    # client sending both an (empty) archive part and a gtfs URL should fall
    # through to the URL rather than hit the both-inputs error. UploadFile.size
    # is set by starlette's multipart parser before the handler runs, so this
    # is known without reading the file.
    archive_is_empty = archive is not None and archive.size == 0
    has_archive = archive is not None and not archive_is_empty
    has_url = bool(gtfs_url)

    if has_archive and has_url:
        return _error(400, "provide exactly one of an archive file or a gtfs URL, not both")
    if not has_archive and not has_url:
        if archive_is_empty:
            return _error(400, "archive must not be empty")
        return _error(400, "provide exactly one of an archive file or a gtfs URL")

    with tempfile.TemporaryDirectory(prefix="validator-static-endpoint-") as tmp_dir:
        archive_path = Path(tmp_dir) / "gtfs.zip"

        if has_archive:
            assert archive is not None
            try:
                await run_in_threadpool(
                    write_capped, archive.file, archive_path, max_bytes=limits.max_compressed_bytes
                )
            except ArchiveTooLarge as exc:
                return _error(400, str(exc))
            gtfs_input = archive.filename or "upload"
        else:
            try:
                await run_in_threadpool(
                    download,
                    gtfs_url,
                    archive_path,
                    timeout=limits.fetch_timeout_seconds,
                    max_bytes=limits.max_compressed_bytes,
                )
            except StaticFetchError as exc:
                return _error(502, str(exc))
            gtfs_input = gtfs_url

        try:
            await run_in_threadpool(
                check_uncompressed_size, archive_path, max_uncompressed_bytes=limits.max_uncompressed_bytes
            )
        except ArchiveTooLarge as exc:
            return _error(400, str(exc))

        body = await run_in_threadpool(_validate_and_serialize, archive_path, gtfs_input=gtfs_input)

    return Response(content=body, status_code=200, media_type="application/json")


def _validate_and_serialize(archive_path: Path, *, gtfs_input: str) -> str:
    """`validate_static_archive`'s result can carry a raw `Decimal` in a
    notice's context, which stdlib `json` (what `JSONResponse` uses) cannot
    serialize. `dumps_json` is the package's own serializer and already
    handles it; both calls are made here, inside the one threadpooled step,
    rather than serializing back on the event loop.
    """
    result = validate_static_archive(archive_path, gtfs_input=gtfs_input)
    text: str = dumps_json(result)
    return text


def _error(status_code: int, message: str) -> JSONResponse:
    content: dict[str, Any] = {"error": message}
    return JSONResponse(status_code=status_code, content=content)
