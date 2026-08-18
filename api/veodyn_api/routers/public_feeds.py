"""The one unauthenticated route in this service's community surface.

No `Identity` dependency, no cookie, no key: a public GTFS-Realtime feed is
meant to be read by anything that speaks the format. Every refusal answers 404
with the same body whatever caused it (unknown slug, private feed, nothing
published yet), so a caller cannot learn which slugs are taken one guess at a
time. `app/src/app/api/public/visualizations/[token]/route.ts` draws the same
line.

`slug` is unique only within one org, and this path carries no org segment, so
migration 0013's partial unique index on `slug` where `visibility = 'public'`
prevents the cross-org collision rather than leaving it to be arbitrated at
read time. Partial, because a private feed has no anonymous address to collide
over. The ambiguity branch below cannot fire on a migrated database; it stays
for one that reached head some other way.
"""

import time
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from veodyn_api.db import get_db
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.models.publish_attempt import PublishAttempt
from veodyn_api.models.published_feed import PublishedFeed

router = APIRouter(prefix="/public/feeds", tags=["public-feeds"])

DbDep = Annotated[Session, Depends(get_db)]

GTFS_RT_CONTENT_TYPE = "application/x-protobuf"


def _now_epoch() -> int:
    """The clock, behind a name so a test can freeze it.

    Unlike `publish_engine`, which takes `feed_timestamp` from its caller, a
    read endpoint has to look: staleness is a fact about the request's moment.
    """
    return int(time.time())


def _not_found(slug: str) -> ApiError:
    return ApiError(ErrorId.PUBLIC_FEED_NOT_FOUND, f"no public feed at {slug!r}", status_code=404)


def _too_stale(slug: str, cap_seconds: int | None) -> JSONResponse:
    """503 with `Retry-After`, per design section 6.5, and NOT an `ApiError`.

    `ApiError` carries no headers, and the handler in `errors.py` sends every
    `status_code >= 500` to telemetry as a service fault, which this is not.

    Unlike the identical 404s, this does disclose that the slug names a public
    feed which has published before and is currently stale, which is what
    section 6.5 asks for. `Retry-After` is the feed's own configured cap, the
    only interval anybody has stated about its tolerable staleness.

    `cap_seconds` is None only for a `last_good` binding carrying no cap, which
    `ck_published_feed_cap_matches_mode` forbids in both directions. That case
    fails closed and sends no `Retry-After` rather than reporting a cap of zero.
    """
    if cap_seconds is None:
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "id": ErrorId.PUBLIC_FEED_TOO_STALE.value,
                    "message": (
                        f"the feed at {slug!r} is set to last_good but carries no age cap, "
                        "so nothing can be certified fresh enough to serve"
                    ),
                }
            },
        )
    return JSONResponse(
        status_code=503,
        headers={"retry-after": str(cap_seconds)},
        content={
            "error": {
                "id": ErrorId.PUBLIC_FEED_TOO_STALE.value,
                "message": (
                    f"the feed at {slug!r} has no artifact newer than its {cap_seconds}s "
                    "last-good age cap, so it is withheld rather than served stale"
                ),
            }
        },
    )


# Declared because the return annotation is a bare `Response`, whose FastAPI
# default is `application/json`: left alone, the committed openapi.json
# advertises JSON for an endpoint that only ever answers protobuf, and a
# generated client tries to JSON-decode a GTFS-Realtime message.
@router.get(
    "/{slug}",
    response_class=Response,
    responses={
        200: {
            "content": {GTFS_RT_CONTENT_TYPE: {"schema": {"type": "string", "format": "binary"}}},
            "description": "The feed's current GTFS-Realtime message.",
        }
    },
)
def get_public_feed(slug: str, db: DbDep) -> Response:
    """The current artifact for one public feed, as raw GTFS-Realtime bytes."""
    # ONE statement, joining the artifact to the binding that authorizes it.
    # Two statements are two snapshots under READ COMMITTED, so a feed flipped to
    # `private` and republished between them would have served the new private
    # bytes on the strength of a binding row that was public when it was read.
    #
    # An OUTER join driven from the BINDING side, so the row count counts
    # bindings: an inner join returns a single row when two public bindings share
    # a slug and only one has published, which is the arbitrary pick refused
    # below. `is_current` stays per feed rather than per revision, as
    # `current_artifact` explains.
    rows = list(
        db.execute(
            select(PublishedFeed, PublishAttempt)
            .outerjoin(
                PublishAttempt,
                (PublishedFeed.org_slug == PublishAttempt.org_slug)
                & (PublishedFeed.slug == PublishAttempt.slug)
                & PublishAttempt.is_current.is_(True),
            )
            .where(
                PublishedFeed.slug == slug,
                PublishedFeed.visibility == "public",
            )
            # Two is enough to know it is not one. The collision is
            # unique-indexed away at the write path (migration 0013), so the cap
            # only bounds a database that holds one anyway.
            .limit(2)
        )
    )
    if len(rows) != 1:
        # Zero is an unknown or private slug, more than one is the cross-org
        # collision. Both answer identically rather than leaking which it was.
        raise _not_found(slug)

    feed, artifact = rows[0]
    if artifact is None or artifact.feed_bytes is None:
        # Declared, but nothing servable exists yet: no attempt has published, or
        # none since a binding edit took the feed off the air. `feed_bytes is
        # None` is defensive, since `ck_publish_attempt_bytes_match_decision`
        # already ties a `published` decision to non-null bytes.
        raise _not_found(slug)

    # Design section 6.5: `block` never stops serving on age alone, so it needs
    # no branch here; it refuses to PUBLISH a bad read, which the engine already
    # did before these bytes became current. `last_good` serves the same last
    # valid artifact PLUS its required cap, past which this answers 503.
    if feed.on_error == "last_good":
        # Non-null whenever the mode is `last_good`, by
        # ck_published_feed_cap_matches_mode.
        cap = feed.last_good_max_age_seconds
        stamp = artifact.feed_timestamp
        if cap is None or stamp is None or _now_epoch() - stamp > cap:
            # Measured against the artifact's own HEADER timestamp, which is what
            # the served bytes tell a consumer the data's time is and what the
            # cap promises about; `created_at` would measure our pipeline instead
            # and call a fresh publish of hours-old rows current. A missing stamp
            # or cap fails closed into the same branch.
            return _too_stale(slug, cap)

    return Response(content=artifact.feed_bytes, media_type=GTFS_RT_CONTENT_TYPE)
