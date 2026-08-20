"""FastAPI dependency wiring: pulling app-scoped objects out of `app.state`.

One indirection, so route handlers depend on `get_cache` / `get_static_limits`
and a test can override either with `app.dependency_overrides` instead of
reaching into `app.state` directly.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Request as FastAPIRequest
from gtfs_rt_validator.api import PreparedFeed

from validator_service.cache import PreparedFeedCache


def get_cache(request: FastAPIRequest) -> PreparedFeedCache[PreparedFeed]:
    cache: PreparedFeedCache[PreparedFeed] = request.app.state.cache
    return cache


@dataclass(frozen=True, slots=True)
class StaticLimits:
    """The `/validate-static` route's tunables, read once from `Settings`."""

    fetch_timeout_seconds: float
    max_compressed_bytes: int
    max_uncompressed_bytes: int


def get_static_limits(request: FastAPIRequest) -> StaticLimits:
    limits: StaticLimits = request.app.state.static_limits
    return limits
