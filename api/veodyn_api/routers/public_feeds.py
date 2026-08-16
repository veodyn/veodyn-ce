"""The one unauthenticated route in this service's community surface.

No `Identity` dependency, no cookie, no key. Everything else in this service
resolves the caller through `require_identity`, first as a Redash session or a
personal API key. A public GTFS-Realtime feed is meant to be read by anything
that speaks the format, most of which will never hold either.

Every refusal answers 404 with the same body, whatever caused it: an unknown
slug, a slug naming a `private` feed, and a slug that has never published a
clean attempt are indistinguishable here on purpose.
`app/src/app/api/public/visualizations/[token]/route.ts` draws the same line
for the same reason -- telling the causes apart would rebuild the probing
oracle a single 404 exists to close, letting a caller learn which slugs are
taken, or merely dark, one guess at a time.

**Cross-org lookup, and what that means for a slug collision.** An anonymous
caller carries no `org_slug`, and the path this endpoint serves
(`/public/feeds/<slug>`, not `/public/feeds/<org>/<slug>`) is fixed by the
design. `slug` is unique only within one org -- `org_slug` is half
`PublishedFeed`'s primary key -- so nothing in the table's own shape stops two
orgs each publishing a `public` feed at one slug, and this endpoint would have
no way to tell which one a caller meant.

Refusing that at read time is safe for the reader and is itself an attack:
whoever creates the SECOND public feed at a slug takes the first one dark, from
another tenant, without publishing anything. So the collision is **prevented**
rather than arbitrated, by migration 0013's partial unique index on `slug`
where `visibility = 'public'`. Partial, because a private feed has no anonymous
address to collide over.

The ambiguity branch below therefore cannot fire on a migrated database. It
stays because it is what protects one that reached head some other way, which
the root CLAUDE.md records as a real occurrence here, and because a refusal is
the only answer that is not silently wrong for one of the two tenants.
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

    `publish_engine` deliberately reads no clock at all and has the caller pass
    `feed_timestamp` in. A read endpoint cannot do that: staleness is a fact
    about the moment of the request, so this one has to look.
    """
    return int(time.time())


def _not_found(slug: str) -> ApiError:
    return ApiError(ErrorId.PUBLIC_FEED_NOT_FOUND, f"no public feed at {slug!r}", status_code=404)


def _too_stale(slug: str, cap_seconds: int | None) -> JSONResponse:
    """503 with `Retry-After`, per design section 6.5, and NOT an `ApiError`.

    Two reasons it is built here rather than raised. `ApiError` carries no
    headers, and `Retry-After` is half of what this response says. And the
    handler in `errors.py` sends every `status_code >= 500` to telemetry as a
    service fault, which this is not: the operator asked for exactly this
    behaviour by setting a cap, so a consumer polling a stale feed would
    otherwise file an error event on every request.

    **What 503 discloses, stated exactly rather than waved away.** It does tell
    an anonymous caller something a 404 would not: that this slug names a
    `public` feed which has published before and is currently stale, and
    `Retry-After` gives them its configured cap. That is a real disclosure, and
    a caller learns it without having to catch the feed fresh first.

    It is nonetheless the contract section 6.5 asks for, and it discloses none
    of what the identical-404 rule exists to protect: a private feed, a
    never-published one, an unknown slug and a cross-org collision all still
    answer the same 404, and no artifact bytes leave here. The thing revealed
    is the existence and staleness of a feed whose whole purpose is to be read
    by anyone.

    `Retry-After` is the feed's own cap. That is not a prediction of when the
    next publish lands, which this endpoint cannot know; it is the only
    interval anybody has stated about this feed's tolerable staleness, so it is
    the one honest number available rather than an invented one.

    `cap_seconds` is None only for a binding that says `last_good` while
    carrying no cap, which `ck_published_feed_cap_matches_mode` forbids in both
    directions. That case still fails closed, but it says so instead of
    reporting a cap of zero and it sends no `Retry-After`, because there is no
    interval to name and a made-up one would be worse than the header's absence.
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


# Declared, because the return annotation is a bare `Response` and FastAPI's
# default for that is `application/json`. Left to the default, the committed
# openapi.json advertises JSON for an endpoint that only ever answers protobuf,
# and a generated client built from that contract tries to JSON-decode a
# GTFS-Realtime message. The hand-written proxy in `app/` is unaffected either
# way, which is exactly why this would have gone unnoticed here.
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
    # ONE statement, joining the artifact to the binding that authorizes it,
    # rather than reading the binding and then asking `current_artifact` for its
    # bytes. Two statements are two snapshots under READ COMMITTED, so a feed
    # flipped to `private` and republished between them would have handed this
    # request the new private bytes on the strength of a binding row that was
    # public when it was read. Joined here, the visibility test and the byte
    # fetch cannot disagree, because there is no instant between them.
    #
    # `is_current` is per feed and not per revision, which is deliberate and
    # explained on `current_artifact`; this join keeps that behaviour and only
    # removes the gap.
    #
    # An OUTER join, driven from the BINDING side, so the row count counts
    # bindings. An inner join counts artifacts instead, and the two differ in
    # exactly the case the ambiguity branch exists for: a database holding two
    # public bindings at one slug of which only one has ever published returns a
    # single row and serves that tenant's bytes, which is the arbitrary pick
    # this endpoint refuses to make.
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
            # unique-indexed away at the write path (migration 0013), so this
            # cannot fire on a migrated database; the cap is here so that a
            # database which somehow holds the collision anyway costs one extra
            # row rather than a scan of every feed sharing the slug.
            .limit(2)
        )
    )
    if len(rows) != 1:
        # Zero is an unknown slug or a private one. More than one is the
        # cross-org collision the module docstring covers. Both answer
        # identically rather than either leaking which case it was.
        raise _not_found(slug)

    feed, artifact = rows[0]
    if artifact is None or artifact.feed_bytes is None:
        # Declared, but nothing this endpoint may serve exists yet: no attempt
        # has published, or none has published since a binding edit took the
        # feed off the air. `feed_bytes is None` is defensive rather than a
        # path the schema allows in practice -- the CHECK constraint on
        # `publish_attempt` already ties a `published` decision to non-null
        # bytes, and `current_artifact` only ever returns a current pointer,
        # which is only ever set on a `published` row.
        raise _not_found(slug)

    # THE ON-FAILURE MODES, and the whole of the difference between them.
    #
    # Design section 6.5: `block` keeps serving the last valid artifact with its
    # original header timestamp while the status surface reports the failed
    # attempt, and "never stops serving on age alone". `last_good` is the same
    # PLUS its required cap, past which this endpoint answers 503.
    #
    # So `block` needs no branch here at all, and that is not an omission. The
    # names read backwards: it is `last_good`, the tolerant-sounding one, that
    # can take a feed off the air, because the operator who picks it also has to
    # say how stale is too stale. `block` is about refusing to PUBLISH a bad
    # read, which the engine already did before these bytes became current.
    if feed.on_error == "last_good":
        # Non-null whenever the mode is `last_good`: refused by the schema and
        # by ck_published_feed_cap_matches_mode, in both directions.
        cap = feed.last_good_max_age_seconds
        stamp = artifact.feed_timestamp
        if cap is None or stamp is None or _now_epoch() - stamp > cap:
            # Measured against the artifact's own HEADER timestamp, not against
            # when the attempt was recorded. That is what the served bytes tell
            # a consumer the data's time is, and it is the number the cap is a
            # promise about; `created_at` would measure our pipeline instead and
            # would call a fresh publish of hours-old rows current.
            #
            # A missing stamp or cap fails closed into the same branch. Neither
            # is reachable through the write path, and the alternative on an
            # unreachable branch is serving unbounded staleness under the one
            # mode whose entire purpose is to bound it.
            return _too_stale(slug, cap)

    return Response(content=artifact.feed_bytes, media_type=GTFS_RT_CONTENT_TYPE)
