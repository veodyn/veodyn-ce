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

from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from veodyn_api.db import get_db
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.models.publish_attempt import PublishAttempt
from veodyn_api.models.published_feed import PublishedFeed

router = APIRouter(prefix="/public/feeds", tags=["public-feeds"])

DbDep = Annotated[Session, Depends(get_db)]

GTFS_RT_CONTENT_TYPE = "application/x-protobuf"


def _not_found(slug: str) -> ApiError:
    return ApiError(ErrorId.PUBLIC_FEED_NOT_FOUND, f"no public feed at {slug!r}", status_code=404)


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

    artifact = rows[0][1]
    if artifact is None or artifact.feed_bytes is None:
        # Declared, but nothing this endpoint may serve exists yet: no attempt
        # has published, or none has published since a binding edit took the
        # feed off the air. `feed_bytes is None` is defensive rather than a
        # path the schema allows in practice -- the CHECK constraint on
        # `publish_attempt` already ties a `published` decision to non-null
        # bytes, and `current_artifact` only ever returns a current pointer,
        # which is only ever set on a `published` row.
        raise _not_found(slug)

    return Response(content=artifact.feed_bytes, media_type=GTFS_RT_CONTENT_TYPE)
