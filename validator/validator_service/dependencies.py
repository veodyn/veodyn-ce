"""FastAPI dependency wiring: pulling app-scoped objects out of `app.state`.

One indirection, so route handlers depend on `get_cache` and a test can
override it with `app.dependency_overrides` instead of reaching into
`app.state` directly.
"""

from __future__ import annotations

from fastapi import Request as FastAPIRequest
from gtfs_rt_validator.api import PreparedFeed

from validator_service.cache import PreparedFeedCache


def get_cache(request: FastAPIRequest) -> PreparedFeedCache[PreparedFeed]:
    cache: PreparedFeedCache[PreparedFeed] = request.app.state.cache
    return cache
