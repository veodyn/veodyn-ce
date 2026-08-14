"""Where the built-in surfaces register themselves.

Importing this package is what turns them on, so `main.create_app` and the
worker tick both reach it through `extras.load_registrations` rather than each
holding its own list. A new endpoint group is one line here, in a file with no
other logic in it.

Routers are not the only thing registered by an import: `routers/catalog.py`
registers the `dataset` object type beside its endpoint, because the kind and
the endpoint are owned by the same code. Anything a module contributes belongs
next to the module that owns it, and that is the property that let the whole
enterprise half move out of this tree: it took two lines with it, the import of
`builtin_ee` and the `register_enterprise()` call at the bottom, and nothing
else here changed. What used to be those two lines is now
`VEODYN_EXTRA_MODULES=veodyn_enterprise.registration` on a deployment that has
the pack.
"""

from veodyn_api.registry import register_router
from veodyn_api.routers.ai import router as ai_router
from veodyn_api.routers.catalog import router as catalog_router
from veodyn_api.routers.domains import router as domains_router
from veodyn_api.routers.favorites import router as favorites_router
from veodyn_api.routers.feed_capabilities import router as feed_capabilities_router
from veodyn_api.routers.feeds import router as feeds_router
from veodyn_api.routers.public_feeds import router as public_feeds_router
from veodyn_api.routers.published_feed_attempts import router as published_feed_attempts_router
from veodyn_api.routers.published_feeds import router as published_feeds_router
from veodyn_api.routers.tags import router as tags_router

for _router in (
    ai_router,
    catalog_router,
    domains_router,
    favorites_router,
    # Registered ahead of published_feeds_router, not alphabetically: both
    # mount under "/published-feeds", FastAPI matches in registration order
    # with no preference for a static segment over a path parameter, and
    # published_feeds_router's `GET /{slug}` would otherwise swallow
    # `GET /capabilities` before this router ever saw it. See
    # feed_capabilities.py's own docstring for the fuller version.
    feed_capabilities_router,
    feeds_router,
    public_feeds_router,
    published_feeds_router,
    published_feed_attempts_router,
    tags_router,
):
    register_router(_router)
