"""Which feed an anonymous address resolves to, and what it currently serves.

Split out of `routers/public_feeds.py` so the router is left with what it
answers rather than how it decides. Both of its routes resolve through `served`,
so the refusals cannot drift apart: a member file that resolved by a different
rule than the discovery document would be a second place to learn which slugs
exist.

`slug` is unique only within one org, and this path carries no org segment, so
migration 0013's partial unique index on `slug` where `visibility = 'public'`
prevents the cross-org collision rather than leaving it to be arbitrated at
read time. Partial, because a private feed has no anonymous address to collide
over. The ambiguity branch below cannot fire on a migrated database; it stays
for one that reached head some other way.
"""

from typing import TypeGuard

from sqlalchemy import select
from sqlalchemy.orm import Session

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.models.publish_attempt import PublishAttempt
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services.publish_engine import current_artifact
from veodyn_api.services.published_feed_token_registry import resolve_feed_for_token

Artifact = tuple[PublishedFeed, PublishAttempt]


def not_found(slug: str) -> ApiError:
    return ApiError(ErrorId.PUBLIC_FEED_NOT_FOUND, f"no public feed at {slug!r}", status_code=404)


def _servable(artifact: PublishAttempt | None) -> TypeGuard[PublishAttempt]:
    """Declared is not published. No attempt has published, or none since a
    binding edit took the feed off the air. The artifact check is defensive,
    since `ck_publish_attempt_artifact_matches_decision` already ties a
    `published` decision to one artifact kind or the other."""
    return artifact is not None and not (artifact.feed_bytes is None and artifact.feed_files is None)


def public_artifact(db: Session, slug: str) -> Artifact | None:
    """The public binding at `slug` and the artifact it currently serves."""
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
    # Zero is an unknown or private slug, more than one is the cross-org
    # collision. Both answer identically rather than leaking which it was.
    if len(rows) != 1:
        return None

    feed, artifact = rows[0]
    return (feed, artifact) if _servable(artifact) else None


def token_artifact(db: Session, slug: str, token: str) -> Artifact | None:
    """The feed a registered resolver grants this token, and what it serves.

    None whenever nothing registered answers, which covers a community build
    with no pack, an unknown token, a revoked one and an expired one in one
    branch. The slug is re-checked against the feed handed back: a resolver is
    pack code, and a bug in one must not be able to serve a feed at an address
    that is not its own.
    """
    feed = resolve_feed_for_token(db, slug, token)
    if feed is None or feed.slug != slug:
        return None
    artifact = current_artifact(db, feed)
    return (feed, artifact) if _servable(artifact) else None


def served(db: Session, slug: str, token: str | None) -> Artifact:
    """What this address answers with, or the one refusal every cause shares.

    The public lookup runs first and unchanged, so a public feed serves whether
    or not a token came with it. Only a public miss spends the token, and only
    a presented one: with no resolver registered this is exactly the public
    lookup and nothing else.
    """
    found = public_artifact(db, slug)
    if found is None and token is not None:
        found = token_artifact(db, slug, token)
    if found is None:
        raise not_found(slug)
    return found
