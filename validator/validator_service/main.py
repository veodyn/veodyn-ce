"""The FastAPI application: wiring settings, the cache and the routes together.

`create_app` takes an optional `Settings` so a test can build an app against a
throwaway cache configuration without touching environment variables; `app`
below is the one real process entry point uvicorn imports.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import partial

from fastapi import FastAPI
from gtfs_rt_validator.api import PreparedFeed

from validator_service.body_size_limit import MaxBodySizeMiddleware
from validator_service.cache import PreparedFeedCache
from validator_service.dependencies import StaticLimits
from validator_service.fetch import fetch_and_prepare
from validator_service.routes import router
from validator_service.settings import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings if settings is not None else Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.cache = PreparedFeedCache[PreparedFeed](
            partial(
                fetch_and_prepare,
                timeout=resolved_settings.static_fetch_timeout_seconds,
                max_bytes=resolved_settings.static_archive_max_compressed_bytes,
            ),
            max_size=resolved_settings.cache_size,
            ttl_seconds=resolved_settings.cache_ttl_seconds,
        )
        app.state.static_limits = StaticLimits(
            fetch_timeout_seconds=resolved_settings.static_fetch_timeout_seconds,
            max_compressed_bytes=resolved_settings.static_archive_max_compressed_bytes,
            max_uncompressed_bytes=resolved_settings.static_archive_max_uncompressed_bytes,
        )
        yield

    app = FastAPI(title="validator-service", lifespan=lifespan)
    # App-wide, not per-route: /validate reads its own realtime upload fully
    # with no bound either, and this rejects an oversized body before either
    # route's multipart parsing spools it to disk. See body_size_limit.py.
    app.add_middleware(MaxBodySizeMiddleware, max_bytes=resolved_settings.static_archive_max_compressed_bytes)
    app.include_router(router)
    return app


app = create_app()
