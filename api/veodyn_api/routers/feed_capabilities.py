"""What this deployment's feed entity registry actually holds, interrogable at
runtime rather than inferred from a values file.

A separate module from `routers/published_feeds.py` on purpose, and not
because of file size. `routers/__init__.py` registers this module's router
BEFORE `published_feeds_router`: FastAPI mounts routes in registration order
and does not prefer a static segment over a path parameter, so
`GET /published-feeds/{slug}` (declared in that other router) would otherwise
swallow `GET /published-feeds/capabilities` first, binding `capabilities` as
`slug` and answering "no feed published at 'capabilities'" instead of ever
reaching this handler. Order is the fix; which file this lives in is not.

Root CLAUDE.md records that an installed layer is inert until a deployment
names it, and the deploy succeeds either way -- costing four releases before
anything checked. This is that check for feeds: a values file that looks
correct, or a green job, is not evidence of what actually registered.
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from veodyn_api.auth import Identity, require_identity
from veodyn_api.schemas.published_feed import FeedCapabilitiesOut
from veodyn_api.services import feed_registry

router = APIRouter(prefix="/published-feeds", tags=["published-feeds"])

IdentityDep = Annotated[Identity, Depends(require_identity)]


@router.get("/capabilities", response_model=FeedCapabilitiesOut)
def get_capabilities(identity: IdentityDep) -> FeedCapabilitiesOut:
    """A read, open to any org member: it names what this build can bind a feed
    to, not who may read one, so it carries the same authorization as listing
    feeds rather than the admin gate that creating or editing one takes."""
    return FeedCapabilitiesOut(entities=sorted(feed_registry.entities()))
