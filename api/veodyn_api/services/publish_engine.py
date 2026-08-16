"""One publish attempt, start to finish.

Takes `validate` as a callable rather than building an HTTP client, so the
engine has no network of its own and a test can drive every branch without
one. The caller owns the clock too: `feed_timestamp` is passed in, which is
what makes the validator's freshness rules deterministic.

**Order is load-bearing.** Serialization runs before validation, so a mapping
defect is named as a mapping defect. Hand the validator bytes built from a
column mapped to the wrong thing and it answers with whatever conformance rule
that happens to trip -- a trip_id that does not exist, a position outside the
agency's bounding box -- and the operator goes looking in the schedule for a
fault that lives in the binding. Only after bytes exist does a verdict mean
anything about them, and only a clean verdict moves the pointer.

**Every expected failure is a recorded attempt, not an exception.** A blocked
feed, an unreadable row and an absent validator are all things this function
was asked to find out, so each returns an `AttemptResult` and leaves a row
behind. The caller is a worker loop; a raise would make an ordinary Tuesday
look like a bug.

**Failing closed is the whole point.** `ValidatorUnavailable` is a failed
attempt and never a pass: an empty finding list from a validator that never
answered is indistinguishable from a clean feed, and treating it as one
publishes bytes nothing checked. So is a verdict from zero enabled rules:
`validate` is injected, so nothing here may lean on the real client's
guarantee. On any decision but `published` the pointer does not move, so the
endpoint keeps serving the last artifact that did pass.

**The pointer and the lineage are scoped differently, and that is deliberate.**
The served pointer is per feed and belongs to whichever revision published it,
because the partial unique index is on `(org_slug, slug)` alone. Everything
that reasons about *sequence* -- the previous feed handed to the validator, the
staleness comparison -- is scoped to one revision, because a binding edit bumps
the revision and changes what the numbers on either side of the comparison
mean. `current_artifact` and `previous_artifact_of_revision` are two different
questions and are never the same row across an edit.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from veodyn_api.models.publish_attempt import PublishAttempt
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services.feed_validator import Finding, ValidationOutcome, ValidatorUnavailable
from veodyn_api.services.finding_json import findings_as_json
from veodyn_api.services.gtfs_rt_serializer import SerializationError, serialize_vehicle_positions

# Deliberately not a registry lookup yet: one entity is supported, and a
# dispatch table over a single entry hides that fact.
_SUPPORTED_ENTITY = "vehicle_positions"

# (feed_bytes, static_gtfs_ref, previous_feed) -> outcome. Named so the engine's
# one dependency on the outside world is a parameter a test can pass, rather
# than an httpx client it would have to intercept.
Validate = Callable[[bytes, str, bytes | None], ValidationOutcome]

# The partial unique index behind the served pointer. Matched by name because
# only this one collision is an ordinary outcome; any other integrity error on
# the publish path is a defect and has to keep raising.
_CURRENT_POINTER_INDEX = "uq_publish_attempt_current"

SUPERSEDED_REASON = "superseded by a concurrent publish for this feed"
BINDING_RETIRED_REASON = "the binding was retired while this attempt was running"


@dataclass(frozen=True)
class AttemptResult:
    """What the attempt decided, why, and everything the validator said.

    `findings` carries warnings on a published attempt too. A feed that
    published is not a feed with nothing to say about it, and dropping the
    warnings at the point of success is how a slow drift into non-conformance
    stays invisible until it becomes an error.
    """

    decision: str
    reason: str
    findings: tuple[Finding, ...]


def current_artifact(db: Session, feed: PublishedFeed) -> PublishAttempt | None:
    """The artifact the endpoint is serving, whatever revision produced it.

    Deliberately not scoped to `feed.revision`. The pointer is per feed -- the
    partial unique index is on `(org_slug, slug)` and knows nothing about
    revisions -- so this is the row a publish has to clear even when a binding
    edit since means it was built from a column map that no longer exists.
    Scope this lookup to the current revision and the old row is never cleared,
    which is a unique violation on the very next publish rather than a tidier
    read.

    Answer this question when you mean "what is being served". For anything
    that compares one artifact to the next, ask `previous_artifact_of_revision`
    instead.
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

    - The iteration rules (E017/E018) compare consecutive feeds. Two feeds
      built from two different column maps are not two versions of one feed,
      and handing them over as if they were invents drift that is not there.
    - Staleness compares `query_result_id`s, which are row ids in one query's
      result history. Repoint a binding at another query and the new lineage's
      ids are unordered against the old one's, so a valid fresher result can
      carry a lower id.

    Revisions only ever move forward, so an artifact of this revision that is
    not the served one cannot exist: anything that cleared the pointer was
    published later, under this revision or a later one.
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
) -> AttemptResult:
    """Write the attempt down and answer with it.

    `feed_bytes` defaults to None and is passed only on the publishing path, so
    that storing servable bytes is a deliberate act at one call site rather
    than the default every early return has to remember to undo. The database
    holds the same line with a CHECK, because a blocked artifact carrying bytes
    is one query away from being served.
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
) -> AttemptResult:
    """Serialize, validate, decide, record. Never raises for an expected failure."""
    if feed.entity != _SUPPORTED_ENTITY:
        return _record(db, feed, query_result_id, "failed", f"entity {feed.entity!r} is not supported yet")

    # Two rows, two questions. `served` is what the endpoint is handing out and
    # is the row a publish must clear, whatever revision built it. `previous` is
    # the artifact this attempt is a successor to, which exists only within one
    # revision. They are the same row until a binding edit, and after one they
    # are not.
    served = current_artifact(db, feed)
    previous = _of_current_revision(served, feed)

    if previous is not None and previous.query_result_id >= query_result_id:
        # Attempts can finish out of order, and a worker retrying a stale result
        # after a fresher one already landed is the ordinary way that happens.
        # Serving an older result than the one already published is a regression
        # the endpoint must never make, so the attempt is refused before any
        # work is done rather than after the pointer has moved back.
        #
        # Only within one revision. A revision bump can mean the binding now
        # reads a different query, and these ids are that query's own row ids;
        # comparing across two lineages refuses valid results forever and wedges
        # the feed.
        return _record(
            db,
            feed,
            query_result_id,
            "failed",
            f"query result {query_result_id} is not newer than the published {previous.query_result_id}",
        )

    try:
        feed_bytes = serialize_vehicle_positions(rows, feed.column_map, feed_timestamp)
    except SerializationError as exc:
        # The validator is never called. It would answer about bytes that do
        # not exist, or worse, about bytes built from a defective mapping, and
        # name a downstream rule instead of the mapping.
        return _record(db, feed, query_result_id, "failed", exc.reason)

    try:
        outcome = validate(feed_bytes, feed.static_gtfs_ref, previous.feed_bytes if previous is not None else None)
    except ValidatorUnavailable as exc:
        return _record(db, feed, query_result_id, "failed", str(exc))

    if not outcome.enabled_rules:
        # No rule produced this verdict, so it is not evidence about the feed.
        # The real client already refuses this shape, but `validate` is injected
        # and the engine is the thing that decides: a verdict nothing checked is
        # the same failure as a validator that never answered, and is recorded
        # as failed rather than blocked because there is no finding to blame.
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
    # landing between the answer and the pointer move below. An earlier check, or
    # an unlocked one, only shrinks that gap to whatever runs after it. A moved
    # revision or a missing row means these bytes answer for a withdrawn binding:
    # republishing them re-airs a retired feed, or one whose row is gone entirely.
    identity = (PublishedFeed.org_slug == feed.org_slug, PublishedFeed.slug == feed.slug)
    revision = db.execute(select(PublishedFeed.revision).where(*identity).with_for_update()).scalar_one_or_none()
    if revision != feed.revision:
        retired = "deleted" if revision is None else f"edited to revision {revision}"
        return _record(db, feed, query_result_id, "failed", f"{BINDING_RETIRED_REASON} ({retired})")

    try:
        if served is not None:
            # Cleared before the new row is added, because one current artifact
            # per feed is a unique index: two would be a constraint violation
            # rather than a silently doubled pointer, and the flush is what puts
            # the UPDATE ahead of the INSERT in the same transaction. `served`
            # rather than `previous`, so an artifact left current by an older
            # revision is cleared too.
            served.is_current = False
            db.flush()

        return _record(db, feed, query_result_id, "published", "", outcome, feed_bytes, feed_timestamp)
    except IntegrityError as exc:
        if _CURRENT_POINTER_INDEX not in str(exc.orig):
            # Some other constraint, which means a defect rather than a race.
            raise
        # Two worker ticks overlapping on one feed is an expected failure, not a
        # bug: both read the same pointer, both cleared it, and the index let
        # exactly one of them replace it. The loser rolls its own clear back --
        # the winner's row stays current, untouched -- and records the attempt,
        # because a worker loop that raises here loses the only trace that this
        # tick ever ran.
        db.rollback()
        return _record(db, feed, query_result_id, "failed", SUPERSEDED_REASON)
