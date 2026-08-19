"""Where the built-in surfaces register themselves.

Importing this package turns them on; `main.create_app` and the worker tick both
reach it through `extras.load_registrations`. Routers are not the only thing an
import registers: `routers/catalog.py` also registers the `dataset` object type
beside its endpoint. Enterprise surfaces are not listed here, a deployment names
them in `VEODYN_EXTRA_MODULES` instead.
"""

from veodyn_api.registry import register_router
from veodyn_api.routers.ai import router as ai_router
from veodyn_api.routers.captures import router as captures_router
from veodyn_api.routers.catalog import router as catalog_router
from veodyn_api.routers.domains import router as domains_router
from veodyn_api.routers.favorites import router as favorites_router
from veodyn_api.routers.public_feeds import router as public_feeds_router
from veodyn_api.routers.published_feed_attempts import router as published_feed_attempts_router
from veodyn_api.routers.published_feed_capabilities import (
    router as published_feed_capabilities_router,
)
from veodyn_api.routers.published_feeds import router as published_feeds_router
from veodyn_api.routers.tags import router as tags_router

for _router in (
    ai_router,
    catalog_router,
    domains_router,
    favorites_router,
    # Must precede published_feeds_router: both mount under "/published-feeds",
    # FastAPI matches in registration order, and `GET /{slug}` would otherwise
    # swallow `GET /capabilities`.
    published_feed_capabilities_router,
    captures_router,
    public_feeds_router,
    published_feeds_router,
    published_feed_attempts_router,
    tags_router,
):
    register_router(_router)
