from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from veodyn_api.auth import Identity, require_identity
from veodyn_api.db import get_db
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.routers.published_feeds import load_feed
from veodyn_api.schemas.published_feed_entities import StaticEntitiesOut, StaticEntityOut
from veodyn_api.services.published_feed_entities import (
    DEFAULT_ENTITY_LIMIT,
    clamped_entity_limit,
    static_entities_of,
)
from veodyn_api.services.published_feed_validator import ValidatorUnavailable
from veodyn_api.settings import Settings, get_settings

router = APIRouter(prefix="/published-feeds", tags=["published-feeds"])

IdentityDep = Annotated[Identity, Depends(require_identity)]
DbDep = Annotated[Session, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings)]

EntityKind = Literal["agency", "route", "stop", "trip"]


@router.get("/{slug}/entities", response_model=StaticEntitiesOut)
def list_static_entities(
    identity: IdentityDep,
    db: DbDep,
    settings: SettingsDep,
    slug: str,
    kind: EntityKind,
    q: Annotated[str | None, Query(max_length=200)] = None,
    limit: int = DEFAULT_ENTITY_LIMIT,
) -> StaticEntitiesOut:
    feed = load_feed(db, identity.org_slug, slug)
    if feed.static_gtfs_ref is None:
        raise ApiError(
            ErrorId.PUBLISHED_FEED_HAS_NO_STATIC_DATASET,
            f"the feed at {slug!r} is paired with no static GTFS dataset, so it has no entities to pick from",
            status_code=404,
        )
    try:
        found = static_entities_of(settings, feed.static_gtfs_ref, kind, q, clamped_entity_limit(limit))
    except ValidatorUnavailable as unavailable:
        raise ApiError(
            ErrorId.PUBLISHED_FEED_ENTITY_LOOKUP_UNAVAILABLE,
            f"the static dataset paired with {slug!r} could not be read, so its {kind}s cannot be listed: "
            f"{unavailable}",
            status_code=503,
        ) from unavailable
    return StaticEntitiesOut(
        feed_version=found.feed_version,
        entities=[StaticEntityOut(kind=e.kind, id=e.id, label=e.label) for e in found.entities],
    )
