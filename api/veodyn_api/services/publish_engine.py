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
`published` the pointer does not move, unless the binding declares
`retire_on_failure`, which is the one setting that takes a feed dark rather than
leaving it serving what it last validated.

**Ordering is a source version, not a query result id.** A query-backed feed
fills it from the result id and behaves exactly as it always has; a feed built
from an aggregate has no result id and supplies its own monotonic number.
Never a clock: two attempts inside one tick would compare equal, and equal is
what this guard refuses.

**Production is a registration, not a branch.** An entity declares the producer
that builds it, so widening the rail is a `register_producer` call rather than
an edit here, and every producer reaches the same shared tail.

**The pointer and the lineage are scoped differently.** The served pointer is
per feed, because the partial unique index is on `(org_slug, slug)` alone.
Anything reasoning about SEQUENCE (the previous feed handed to the validator,
the staleness comparison) is scoped to one revision, because a binding edit
bumps the revision and changes what the compared numbers mean.
"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services.publish_produce import (
    GbfsPublisher,
    Production,
    Refused,
    Validate,
    anything_is_registered_under,
    producer_for,
    unbuildable_reason,
)
from veodyn_api.services.publish_record import (
    AttemptResult,
    AttemptSource,
    a_header_timestamp_that_never_goes_backwards,
    current_artifact,
    of_current_revision,
    previous_artifact_of_revision,
    published_high_water_mark,
    record,
    record_and_retire_if_the_binding_says_to,
)

__all__ = [
    "AttemptResult",
    "GbfsPublisher",
    "Validate",
    "a_header_timestamp_that_never_goes_backwards",
    "current_artifact",
    "previous_artifact_of_revision",
    "run_attempt",
]

# The partial unique index behind the served pointer. Matched by name because
# only this one collision is an ordinary outcome; any other integrity error on
# the publish path is a defect and has to keep raising.
_CURRENT_POINTER_INDEX = "uq_publish_attempt_current"

SUPERSEDED_REASON = "superseded by a concurrent publish for this feed"
BINDING_RETIRED_REASON = "the binding was retired while this attempt was running"


def run_attempt(
    db: Session,
    feed: PublishedFeed,
    rows: list[dict[str, Any]],
    query_result_id: int | None,
    feed_timestamp: int,
    validate: Validate,
    *,
    source_version: int | None = None,
    gbfs: GbfsPublisher | None = None,
) -> AttemptResult:
    """Serialize, validate, decide, record. Never raises for an expected failure.

    `gbfs` is keyword-only and optional because the enterprise worker calls this
    positionally from another repository. A gbfs feed reaching a worker that
    passed none is a failed attempt, not a crash.

    `source_version` is keyword-only for the same reason, and defaults to
    `query_result_id`, so a caller that has never heard of it orders exactly as
    it always did. A caller with no query behind it passes None for the result
    id and a monotonic number of its own here.

    Only the production step differs by entity, and it is a registered producer
    rather than a branch. Everything from the verdict onward is shared, so a
    second standard cannot quietly acquire a weaker ordering guard or a looser
    pointer move.
    """
    version = query_result_id if source_version is None else source_version
    if version is None:
        raise ValueError("an attempt orders on a query result id or an explicit source version, and got neither")
    source = AttemptSource(version=version, query_result_id=query_result_id)

    if not anything_is_registered_under(feed.standard):
        reason = f"standard {feed.standard!r} is not supported yet"
        return record_and_retire_if_the_binding_says_to(db, feed, source, "failed", reason)
    producer = producer_for(feed.standard, feed.entity)
    if producer is None:
        reason = unbuildable_reason(feed.standard, feed.entity)
        return record_and_retire_if_the_binding_says_to(db, feed, source, "failed", reason)

    # Two rows, two questions. `served` is the row a publish must clear, whatever
    # revision built it; `previous` is the artifact this attempt succeeds, which
    # exists only within one revision.
    served = current_artifact(db, feed)
    previous = of_current_revision(served, feed)

    watermark = published_high_water_mark(db, feed)
    if watermark is not None and watermark >= version:
        return record(
            db,
            feed,
            source,
            "failed",
            f"source version {version} is not newer than the published {watermark}",
        )

    try:
        outcome, feed_bytes, feed_files = producer(
            Production(
                feed=feed,
                rows=rows,
                feed_timestamp=feed_timestamp,
                previous_artifact_of_this_revision=previous,
                validate=validate,
                gbfs=gbfs,
            )
        )
    except Refused as refusal:
        return record_and_retire_if_the_binding_says_to(db, feed, source, "failed", refusal.reason)

    if not outcome.enabled_rules:
        # No rule produced this verdict, so it is not evidence about the feed.
        # Recorded as failed rather than blocked because there is no finding to
        # blame. Re-checked here because `validate` is injected.
        return record_and_retire_if_the_binding_says_to(
            db,
            feed,
            source,
            "failed",
            "validator reported no enabled rules, so the verdict covers nothing",
            outcome,
        )

    if outcome.has_error:
        return record_and_retire_if_the_binding_says_to(
            db,
            feed,
            source,
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
        reason = f"{BINDING_RETIRED_REASON} ({retired})"
        return record(db, feed, source, "failed", reason)

    try:
        if served is not None:
            # Cleared before the new row is added, since one current artifact per
            # feed is a unique index; the flush puts the UPDATE ahead of the
            # INSERT. `served` rather than `previous`, so an artifact left current
            # by an older revision is cleared too.
            served.is_current = False
            db.flush()

        return record(
            db,
            feed,
            source,
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
        return record(db, feed, source, "failed", SUPERSEDED_REASON)
