"""What this deployment's feed registry actually holds, per standard, read at
runtime rather than inferred from a values file or a green job.

`routers/__init__.py` must register this router before `published_feeds_router`:
FastAPI matches in registration order, so that router's `GET /{slug}` would
otherwise swallow `GET /published-feeds/capabilities`.
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from veodyn_api.auth import Identity, require_identity
from veodyn_api.schemas.published_feed_capabilities import (
    EntityNeedsOut,
    FeedCapabilitiesOut,
    StandardCapabilityOut,
)
from veodyn_api.services import gbfs_vocabulary, publish_produce, published_feed_registry

router = APIRouter(prefix="/published-feeds", tags=["published-feeds"])

IdentityDep = Annotated[Identity, Depends(require_identity)]


def _needs_out(standard: str, entity: str) -> EntityNeedsOut:
    needs = publish_produce.needs_for(standard, entity)
    return EntityNeedsOut(
        query=needs.query,
        static_reference=needs.static_reference,
        column_map=needs.column_map,
        retirement_on_failure=needs.retirement_on_failure,
    )


def _standard_out(standard: str) -> StandardCapabilityOut:
    entities = sorted(published_feed_registry.entities(standard))
    return StandardCapabilityOut(
        standard=standard,
        versions=list(published_feed_registry.VERSIONS_BY_STANDARD.get(standard, ())),
        entities=entities,
        entity_needs={entity: _needs_out(standard, entity) for entity in entities},
        timezones=list(gbfs_vocabulary.timezones_for(standard)),
    )


@router.get("/capabilities", response_model=FeedCapabilitiesOut)
def get_capabilities(identity: IdentityDep) -> FeedCapabilitiesOut:
    """Name the standards, versions and feed entities this build can bind a feed
    to, and what each entity's producer needs of a binding. A read open to any
    org member, the same authorization as listing feeds."""
    return FeedCapabilitiesOut(
        standards=[_standard_out(standard) for standard in sorted(published_feed_registry.standards())]
    )
