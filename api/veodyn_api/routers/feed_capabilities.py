"""What this deployment's feed entity registry actually holds, read at runtime
rather than inferred from a values file or a green job.

`routers/__init__.py` must register this router before `published_feeds_router`:
FastAPI matches in registration order, so that router's `GET /{slug}` would
otherwise swallow `GET /published-feeds/capabilities`.
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
    """Name the feed entities this build can bind a feed to. A read open to any
    org member, the same authorization as listing feeds."""
    return FeedCapabilitiesOut(entities=sorted(feed_registry.entities()))
