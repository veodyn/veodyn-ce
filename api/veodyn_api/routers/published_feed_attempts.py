"""Reading and running publish attempts for one feed.

Split out of published_feeds.py by the file-size hook: Task 1 already left
that router at 274 lines against a 300-line hard block, and neither the read
side moved here nor the new run-one-attempt endpoint fit alongside it.
`load_feed` and `require_admin` are imported from there because a slug still
has to resolve to a binding and publishing still needs an admin, the same rule
every other write on this resource already holds.
"""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, defer

from veodyn_api.auth import Identity, get_redash_client, require_identity
from veodyn_api.db import get_db
from veodyn_api.models.publish_attempt import PublishAttempt
from veodyn_api.routers.published_feeds import load_feed, require_admin
from veodyn_api.schemas.published_feed import FindingOut, PublishAttemptOut
from veodyn_api.services.publish_engine import run_attempt
from veodyn_api.services.publish_source import latest_result
from veodyn_api.services.publish_validator import build_validate
from veodyn_api.services.redash import RedashClient
from veodyn_api.settings import Settings, get_settings

router = APIRouter(prefix="/published-feeds", tags=["published-feeds"])

IdentityDep = Annotated[Identity, Depends(require_identity)]
DbDep = Annotated[Session, Depends(get_db)]
RedashDep = Annotated[RedashClient, Depends(get_redash_client)]
SettingsDep = Annotated[Settings, Depends(get_settings)]

# The list is a glance at recent history, not an archive. A feed publishing on
# a short cadence writes a row per tick, and what the page needs is the current
# artifact plus enough context to see a pattern. Paging arrives with a reader
# who needs it, and this constant is where that decision is recorded.
ATTEMPT_PAGE_SIZE = 20


def _iso(moment: datetime) -> str:
    return moment.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _attempt_out(attempt: PublishAttempt) -> PublishAttemptOut:
    return PublishAttemptOut(
        attempt_id=attempt.attempt_id,
        binding_revision=attempt.binding_revision,
        query_result_id=attempt.query_result_id,
        decision=attempt.decision,
        reason=attempt.reason,
        findings=[FindingOut.model_validate(finding) for finding in attempt.findings],
        enabled_rules=list(attempt.enabled_rules),
        is_current=attempt.is_current,
        created_at=_iso(attempt.created_at),
    )


@router.get("/{slug}/attempts", response_model=list[PublishAttemptOut])
def list_attempts(identity: IdentityDep, db: DbDep, slug: str) -> list[PublishAttemptOut]:
    """The recent record for one feed, newest first.

    `load_feed` first, so an unknown slug is a 404 rather than an empty list. A
    feed that was deleted and a feed that has never published are different
    facts and the page says different things about them.

    `defer` on the bytes column is load-bearing, not a micro-optimisation: these
    rows carry the served artifact, and selecting twenty of them to render
    twenty status words would move the whole feed history over the wire.

    The served artifact is added back when the cap pushed it off the page, and
    it is the one row that is not optional context. Twenty blocked or failed
    attempts in a row is exactly the situation where the still-serving artifact
    is older than the page, and a client that reads "what is serving" off this
    list would then conclude a live feed is dark: it would offer to publish over
    it, and skip the going-dark warning on an edit.
    """
    feed = load_feed(db, identity.org_slug, slug)
    identity_of_feed = (PublishAttempt.org_slug == feed.org_slug, PublishAttempt.slug == feed.slug)
    rows = list(
        db.execute(
            select(PublishAttempt)
            .options(defer(PublishAttempt.feed_bytes))
            .where(*identity_of_feed)
            .order_by(PublishAttempt.attempt_id.desc())
            .limit(ATTEMPT_PAGE_SIZE)
        ).scalars()
    )
    served = db.execute(
        select(PublishAttempt)
        .options(defer(PublishAttempt.feed_bytes))
        .where(*identity_of_feed, PublishAttempt.is_current.is_(True))
    ).scalar_one_or_none()
    if served is not None and all(row.attempt_id != served.attempt_id for row in rows):
        # Re-sorted rather than appended, so the caller can keep reading this as
        # one newest-first sequence. It happens to land last today, because a row
        # outside the newest page is older than every row on it, but that is a
        # property of the cap and not something the response should depend on.
        rows.append(served)
        rows.sort(key=lambda row: row.attempt_id, reverse=True)
    return [_attempt_out(row) for row in rows]


@router.post("/{slug}/attempts", response_model=PublishAttemptOut, status_code=201)
def publish_now(
    identity: IdentityDep, db: DbDep, redash: RedashDep, settings: SettingsDep, slug: str
) -> PublishAttemptOut:
    """Run one attempt for this feed, now.

    201 for every decision the engine reaches, including `blocked` and `failed`:
    the attempt was created, which is what this endpoint promises, and its
    decision is the answer rather than the status code. A 4xx here is reserved
    for the cases where no attempt happens at all.

    `run_attempt` records and commits the row itself, so nothing here commits.
    """
    require_admin(identity)
    feed = load_feed(db, identity.org_slug, slug)

    # Before the engine, because a query with no cached result is not a failed
    # attempt: there were no bytes to judge, and recording one would put a
    # failure against the binding for something the binding did not do.
    source = latest_result(redash, feed.query_id, settings.redash_service_api_key)

    run_attempt(
        db,
        feed,
        source.rows,
        query_result_id=source.result_id,
        feed_timestamp=source.retrieved_at,
        validate=build_validate(settings),
    )

    # Narrowed to the row this call wrote, not merely to the newest row for the
    # feed. `run_attempt` records with the revision it was handed and the result
    # id it was given, so those two pin the attempt down; a second publish
    # committing between the run above and this read would otherwise hand this
    # caller the other request's verdict, findings and all.
    #
    # `run_attempt`'s own signature is left alone on purpose: the enterprise
    # worker calls it and this tree does not own that contract.
    recorded = db.execute(
        select(PublishAttempt)
        .options(defer(PublishAttempt.feed_bytes))
        .where(
            PublishAttempt.org_slug == feed.org_slug,
            PublishAttempt.slug == feed.slug,
            PublishAttempt.binding_revision == feed.revision,
            PublishAttempt.query_result_id == source.result_id,
        )
        .order_by(PublishAttempt.attempt_id.desc())
        .limit(1)
    ).scalar_one()
    return _attempt_out(recorded)
