"""One publish attempt, start to finish.

`validate` and `feed_timestamp` are passed in, so the engine has no network and
no clock of its own.

**Order is load-bearing.** Serialization runs before validation, so a mapping
defect is named as a mapping defect rather than as whatever conformance rule the
bad bytes happen to trip. Only a clean verdict moves the pointer.

**Every expected failure is a recorded attempt, not an exception.** The caller
is a worker loop, so each returns an `AttemptResult` and leaves a row behind.

**Fails closed.** `ValidatorUnavailable` and a verdict from zero enabled rules
are both failed attempts, never passes: an empty finding list from a validator
that never answered is indistinguishable from a clean feed. On any decision but
`published` the pointer does not move.

**The pointer and the lineage are scoped differently.** The served pointer is
per feed, because the partial unique index is on `(org_slug, slug)` alone.
Anything reasoning about SEQUENCE (the previous feed handed to the validator,
the staleness comparison) is scoped to one revision, because a binding edit
bumps the revision and changes what the compared numbers mean.
"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from veodyn_api.models.publish_attempt import PublishAttempt
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services.finding_json import findings_as_json
from veodyn_api.services.publish_produce import (
    GbfsPublisher,
    Refused,
    Validate,
    produce_gbfs,
    produce_gtfs_rt,
)
from veodyn_api.services.published_feed_validator import Finding, ValidationOutcome

__all__ = [
    "AttemptResult",
    "GbfsPublisher",
    "Validate",
    "current_artifact",
    "previous_artifact_of_revision",
    "run_attempt",
]

_GBFS_STANDARD = "gbfs"

# The one entity each standard can publish in a community build. A pack widens
# the binding vocabulary, and an entity this engine cannot serialize is a failed
# attempt rather than an exception.
_SUPPORTED_ENTITY = "vehicle_positions"
_SUPPORTED_ENTITIES: dict[str, str] = {"gtfs-rt": _SUPPORTED_ENTITY, _GBFS_STANDARD: "stations"}

# The partial unique index behind the served pointer. Matched by name because
# only this one collision is an ordinary outcome; any other integrity error on
# the publish path is a defect and has to keep raising.
_CURRENT_POINTER_INDEX = "uq_publish_attempt_current"

SUPERSEDED_REASON = "superseded by a concurrent publish for this feed"
BINDING_RETIRED_REASON = "the binding was retired while this attempt was running"


@dataclass(frozen=True)
class AttemptResult:
    """What the attempt decided, why, and everything the validator said.

    `findings` carries warnings on a published attempt too, so a slow drift into
    non-conformance is visible before it becomes an error.
    """

    decision: str
    reason: str
    findings: tuple[Finding, ...]


def current_artifact(db: Session, feed: PublishedFeed) -> PublishAttempt | None:
    """The artifact the endpoint is serving, whatever revision produced it.

    Not scoped to `feed.revision`: the partial unique index is on
    `(org_slug, slug)`, so this is the row a publish has to clear even when a
    binding edit since means it was built from a column map that no longer
    exists. Scoping it to the current revision leaves the old row uncleared,
    which is a unique violation on the next publish.

    For anything that compares one artifact to the next, ask
    `previous_artifact_of_revision` instead.
    """
    return db.execute(
        select(PublishAttempt).where(
            PublishAttempt.org_slug == feed.org_slug,
            PublishAttempt.slug == feed.slug,
            PublishAttempt.is_current.is_(True),
        )
    ).scalar_one_or_none()


def previous_artifact_of_revision(db: Session, feed: PublishedFeed) -> PublishAttempt | None:
    """The served artifact, but only when this binding revision produced it.

    Two comparisons read this rather than `current_artifact`, and both are
    meaningless across a revision boundary:

    - The iteration rules (E017/E018) compare consecutive feeds, and two feeds
      built from different column maps are not two versions of one feed.
    - Staleness compares `query_result_id`s, which are row ids in one query's
      result history, so ids from two lineages are unordered against each other.
    """
    return _of_current_revision(current_artifact(db, feed), feed)


def _of_current_revision(artifact: PublishAttempt | None, feed: PublishedFeed) -> PublishAttempt | None:
    if artifact is None or artifact.binding_revision != feed.revision:
        return None
    return artifact


def _record(
    db: Session,
    feed: PublishedFeed,
    query_result_id: int,
    decision: str,
    reason: str,
    outcome: ValidationOutcome | None = None,
    feed_bytes: bytes | None = None,
    feed_timestamp: int | None = None,
    feed_files: dict[str, Any] | None = None,
) -> AttemptResult:
    """Write the attempt down and answer with it.

    The two artifact columns default to None and are passed only on the
    publishing path, exactly one of them per standard. The database holds the
    same line with a CHECK, because a blocked artifact carrying an artifact is
    one query away from being served.
    """
    findings = outcome.findings if outcome is not None else ()
    db.add(
        PublishAttempt(
            org_slug=feed.org_slug,
            slug=feed.slug,
            binding_revision=feed.revision,
            query_result_id=query_result_id,
            decision=decision,
            reason=reason,
            feed_bytes=feed_bytes,
            feed_files=feed_files,
            feed_timestamp=feed_timestamp,
            findings=findings_as_json(findings),
            enabled_rules=list(outcome.enabled_rules) if outcome is not None else [],
            is_current=decision == "published",
        )
    )
    db.commit()
    return AttemptResult(decision=decision, reason=reason, findings=findings)


def run_attempt(
    db: Session,
    feed: PublishedFeed,
    rows: list[dict[str, Any]],
    query_result_id: int,
    feed_timestamp: int,
    validate: Validate,
    *,
    gbfs: GbfsPublisher | None = None,
) -> AttemptResult:
    """Serialize, validate, decide, record. Never raises for an expected failure.

    `gbfs` is keyword-only and optional because the enterprise worker calls this
    positionally from another repository. A gbfs feed reaching a worker that
    passed none is a failed attempt, not a crash.

    Only the production step differs by standard. Everything from the verdict
    onward is shared, so a second standard cannot quietly acquire a weaker
    ordering guard or a looser pointer move.
    """
    supported = _SUPPORTED_ENTITIES.get(feed.standard)
    if supported is None:
        return _record(db, feed, query_result_id, "failed", f"standard {feed.standard!r} is not supported yet")
    if feed.entity != supported:
        return _record(db, feed, query_result_id, "failed", f"entity {feed.entity!r} is not supported yet")

    # Two rows, two questions. `served` is the row a publish must clear, whatever
    # revision built it; `previous` is the artifact this attempt succeeds, which
    # exists only within one revision.
    served = current_artifact(db, feed)
    previous = _of_current_revision(served, feed)

    if previous is not None and previous.query_result_id >= query_result_id:
        # Attempts can finish out of order, and the endpoint must never serve an
        # older result than the one already published. Only within one revision:
        # these ids are one query's own row ids, so comparing across two lineages
        # refuses valid results forever and wedges the feed.
        return _record(
            db,
            feed,
            query_result_id,
            "failed",
            f"query result {query_result_id} is not newer than the published {previous.query_result_id}",
        )

    try:
        if feed.standard == _GBFS_STANDARD:
            outcome, feed_bytes, feed_files = produce_gbfs(feed, rows, feed_timestamp, gbfs)
        else:
            outcome, feed_bytes, feed_files = produce_gtfs_rt(feed, rows, feed_timestamp, previous, validate)
    except Refused as refusal:
        return _record(db, feed, query_result_id, "failed", refusal.reason)

    if not outcome.enabled_rules:
        # No rule produced this verdict, so it is not evidence about the feed.
        # Recorded as failed rather than blocked because there is no finding to
        # blame. Re-checked here because `validate` is injected.
        return _record(
            db,
            feed,
            query_result_id,
            "failed",
            "validator reported no enabled rules, so the verdict covers nothing",
            outcome,
        )

    if outcome.has_error:
        return _record(
            db,
            feed,
            query_result_id,
            "blocked",
            f"{len(outcome.errors)} conformance error(s)",
            outcome,
        )

    # The binding is re-read LOCKED, and here rather than at the top: an edit or a
    # delete has to write this row, so both wait behind this lock rather than
    # landing between the verdict and the pointer move below. A moved revision or
    # a missing row means these bytes answer for a withdrawn binding.
    identity = (PublishedFeed.org_slug == feed.org_slug, PublishedFeed.slug == feed.slug)
    revision = db.execute(select(PublishedFeed.revision).where(*identity).with_for_update()).scalar_one_or_none()
    if revision != feed.revision:
        retired = "deleted" if revision is None else f"edited to revision {revision}"
        return _record(db, feed, query_result_id, "failed", f"{BINDING_RETIRED_REASON} ({retired})")

    try:
        if served is not None:
            # Cleared before the new row is added, since one current artifact per
            # feed is a unique index; the flush puts the UPDATE ahead of the
            # INSERT. `served` rather than `previous`, so an artifact left current
            # by an older revision is cleared too.
            served.is_current = False
            db.flush()

        return _record(
            db,
            feed,
            query_result_id,
            "published",
            "",
            outcome,
            feed_bytes,
            feed_timestamp,
            feed_files=feed_files,
        )
    except IntegrityError as exc:
        if _CURRENT_POINTER_INDEX not in str(exc.orig):
            # Some other constraint, which means a defect rather than a race.
            raise
        # Two worker ticks overlapping on one feed: both cleared the pointer and
        # the index let exactly one replace it. The loser rolls its own clear back
        # and records the attempt, so the tick leaves a trace.
        db.rollback()
        return _record(db, feed, query_result_id, "failed", SUPERSEDED_REASON)
