"""The unauthenticated routes in this service's community surface.

No `Identity` dependency, no cookie, no key: a public GTFS-Realtime or GBFS feed
is meant to be read by anything that speaks the format. Every refusal answers
404 with the same body whatever caused it (unknown slug, private feed, nothing
published yet, no such member file), so a caller cannot learn which slugs are
taken one guess at a time.
`app/src/app/api/public/visualizations/[token]/route.ts` draws the same line.

`slug` is unique only within one org, and this path carries no org segment, so
migration 0013's partial unique index on `slug` where `visibility = 'public'`
prevents the cross-org collision rather than leaving it to be arbitrated at
read time. Partial, because a private feed has no anonymous address to collide
over. The ambiguity branch below cannot fire on a migrated database; it stays
for one that reached head some other way.
"""

import time
from typing import Annotated, Any

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
GBFS_CONTENT_TYPE = "application/json"

# The one member file a GBFS system is addressed by; the rest hang off it.
GBFS_DISCOVERY_FILE = "gbfs.json"
GBFS_STANDARD = "gbfs"


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


def _served(db: DbDep, slug: str) -> tuple[PublishedFeed, PublishAttempt]:
    """The public binding at `slug` and the artifact it currently serves.

    Shared by both routes so the refusals cannot drift apart: a member file that
    resolved by a different rule than the discovery document would be a second
    place to learn which slugs exist.
    """
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
    if artifact is None or (artifact.feed_bytes is None and artifact.feed_files is None):
        # Declared, but nothing servable exists yet: no attempt has published, or
        # none since a binding edit took the feed off the air. The artifact check
        # is defensive, since `ck_publish_attempt_artifact_matches_decision`
        # already ties a `published` decision to one artifact kind or the other.
        raise _not_found(slug)

    return feed, artifact


def _staleness_refusal(feed: PublishedFeed, artifact: PublishAttempt, slug: str) -> JSONResponse | None:
    """The 503, or None when the artifact may be served.

    Design section 6.5: `block` never stops serving on age alone, so it needs no
    branch here; it refuses to PUBLISH a bad read, which the engine already did
    before this artifact became current. `last_good` serves the same last valid
    artifact PLUS its required cap, past which this answers 503.
    """
    if feed.on_error != "last_good":
        return None
    # Non-null whenever the mode is `last_good`, by
    # ck_published_feed_cap_matches_mode.
    cap = feed.last_good_max_age_seconds
    stamp = artifact.feed_timestamp
    if cap is None or stamp is None or _now_epoch() - stamp > cap:
        # Measured against the artifact's own HEADER timestamp, which is what the
        # served artifact tells a consumer the data's time is and what the cap
        # promises about; `created_at` would measure our pipeline instead and
        # call a fresh publish of hours-old rows current. For gbfs that stamp is
        # the discovery document's `last_updated`. A missing stamp or cap fails
        # closed into the same branch.
        return _too_stale(slug, cap)
    return None


# The content map is declared because the return annotation is a bare
# `Response`, whose FastAPI default is `application/json`: left alone, the
# committed openapi.json advertises JSON for an endpoint that answers protobuf
# for a gtfs-rt feed, and a generated client tries to JSON-decode a
# GTFS-Realtime message.
@router.get(
    "/{slug}",
    response_class=Response,
    responses={
        200: {
            "content": {
                GTFS_RT_CONTENT_TYPE: {"schema": {"type": "string", "format": "binary"}},
                GBFS_CONTENT_TYPE: {"schema": {"type": "object"}},
            },
            "description": "The feed's current artifact: a GTFS-Realtime message, or a GBFS discovery document.",
        }
    },
)
def get_public_feed(slug: str, db: DbDep) -> Response:
    """The current artifact for one public feed, by its standard."""
    feed, artifact = _served(db, slug)

    # The BINDING's standard decides which artifact this address answers with,
    # not the artifact's shape: the CHECK permits a gtfs-rt row carrying
    # `feed_files`, and reading the shape would serve GBFS off a gtfs-rt feed.
    #
    # Resolved BEFORE the staleness branch, for the reason the member route
    # gives: the 503 discloses a live public feed, so an address with nothing to
    # answer must not answer differently once its artifact goes stale.
    discovery: Any | None = None
    if feed.standard == GBFS_STANDARD:
        if artifact.feed_files is None:
            raise _not_found(slug)
        discovery = artifact.feed_files.get(GBFS_DISCOVERY_FILE)
        if discovery is None:
            raise _not_found(slug)
    elif artifact.feed_bytes is None:
        raise _not_found(slug)

    stale = _staleness_refusal(feed, artifact, slug)
    if stale is not None:
        return stale

    if discovery is not None:
        return JSONResponse(status_code=200, content=discovery)
    return Response(content=artifact.feed_bytes, media_type=GTFS_RT_CONTENT_TYPE)


@router.get("/{slug}/{file_name}")
def get_public_feed_file(slug: str, file_name: str, db: DbDep) -> JSONResponse:
    """One member file of a GBFS artifact.

    Every refusal is the same 404 as the discovery route's, whatever caused it:
    an unknown slug, a private feed, nothing published, a gtfs-rt feed with no
    member files at all, or a name outside the published set. The name is never
    echoed back, so the file set cannot be enumerated either.

    The missing-file 404 comes BEFORE the staleness branch on purpose. The 503
    does disclose that the slug names a live public feed, and a name that is not
    in the set must not answer differently for a stale feed than for any other.
    """
    feed, artifact = _served(db, slug)
    # The BINDING's standard decides, not the artifact's shape. Nothing writes
    # member files for a gtfs-rt binding today, and the database would allow it.
    if feed.standard != GBFS_STANDARD or artifact.feed_files is None or file_name not in artifact.feed_files:
        raise _not_found(slug)

    stale = _staleness_refusal(feed, artifact, slug)
    if stale is not None:
        return stale

    return JSONResponse(status_code=200, content=artifact.feed_files[file_name])
