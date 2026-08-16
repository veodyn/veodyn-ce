"""Shared setup for the publish-attempt tests.

Three test modules drive the same engine from different angles -- what it
decides (`test_publish_engine.py`), what the artifact row is allowed to hold
(`test_publish_attempt_artifact.py`) and what happens when something else moves
underneath an attempt already running (`test_publish_in_flight.py`) -- and one
binding plus three canned verdicts is all any of them needs. Kept here rather
than duplicated, so they cannot drift into testing three different feeds.

The verdicts are `ValidationOutcome` values built by hand. Nothing here speaks
to a validator, because the engine takes `validate` as a callable: that seam is
what makes every branch reachable without a container.
"""

from typing import Any

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from veodyn_api.models.publish_attempt import PublishAttempt
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services.feed_validator import Finding, ValidationOutcome
from veodyn_api.services.publish_engine import AttemptResult, Validate, current_artifact, run_attempt

ROWS: list[dict[str, Any]] = [{"bus": "b1", "lat": 34.05, "lon": -118.25}]

# A mapped-but-empty required value. The serializer refuses it rather than
# dropping the row, which is what makes the "never reaches the validator"
# assertion possible at all.
UNSERIALIZABLE: list[dict[str, Any]] = [{"bus": "b1", "lat": None, "lon": -118.25}]

CLEAN = ValidationOutcome(findings=(), enabled_rules=("E003",))
ERRORED = ValidationOutcome(
    findings=(Finding("E003", "ERROR", "trip_id does not exist", "vehicle_id b1 trip_id GHOST", occurrence_count=1),),
    enabled_rules=("E003",),
)
WARNED = ValidationOutcome(
    findings=(Finding("W009", "WARNING", "schedule_relationship not populated", "trip_id t1", occurrence_count=1),),
    enabled_rules=("W009",),
)
# No rule ran, so nothing was checked. Shaped exactly like CLEAN otherwise,
# which is the point: the two are indistinguishable by their findings alone.
UNCHECKED = ValidationOutcome(findings=(), enabled_rules=())


def make_feed(db: Session, **overrides: Any) -> PublishedFeed:
    """A committed binding for `acme/vehicles`, mapping the three required fields."""
    fields: dict[str, Any] = {
        "org_slug": "acme",
        "slug": "vehicles",
        "revision": 1,
        "query_id": 42,
        "standard": "gtfs-rt",
        "version": "2.0",
        "entity": "vehicle_positions",
        "static_gtfs_ref": "https://example.org/gtfs.zip",
        "source_column": None,
        "column_map": {"vehicle_id": "bus", "latitude": "lat", "longitude": "lon"},
        "on_error": "block",
        "last_good_max_age_seconds": None,
        "visibility": "private",
        "created_by_user_id": 7,
    }
    fields.update(overrides)
    feed = PublishedFeed(**fields)
    db.add(feed)
    db.commit()
    return feed


def edit_binding(db: Session, feed: PublishedFeed, **changes: Any) -> PublishedFeed:
    """A binding edit: change what the feed is validated against, bump the revision.

    The router that owns edits does exactly this pair, and the engine keys off
    the bump rather than off any particular field, so which field moves here
    only has to be one a real rebind would move.
    """
    for name, value in changes.items():
        setattr(feed, name, value)
    feed.revision += 1
    db.commit()
    return feed


def retire_binding(engine: Engine, feed: PublishedFeed, *, delete: bool) -> None:
    """Take the binding off the air from a second Session, the way the router does.

    Edit and delete are one helper because the router treats them as one act:
    each retires the declaration an artifact was evidence for, and each clears
    the served pointer in its own transaction. Committed before returning, so
    the caller's session inherits a finished retirement rather than waiting on a
    lock this one still holds.

    The caller's own `feed` object is deliberately not touched. A worker holds a
    binding it loaded before the edit, and the stale revision in hand is the
    thing the engine has to notice.
    """
    with Session(engine) as retiring:
        served = current_artifact(retiring, feed)
        if served is not None:
            served.is_current = False
        bound = retiring.get(PublishedFeed, (feed.org_slug, feed.slug))
        assert bound is not None
        if delete:
            retiring.delete(bound)
        else:
            bound.revision += 1
        retiring.commit()


def attempt_row(
    feed: PublishedFeed,
    *,
    decision: str = "published",
    feed_bytes: bytes | None = b"\x01",
    is_current: bool = True,
    query_result_id: int = 999,
    binding_revision: int | None = None,
    feed_timestamp: int | None = 1800,
) -> PublishAttempt:
    """An artifact row written straight to the table, bypassing the engine.

    Two jobs: standing in for the writer who does not clear the old pointer,
    and standing in for the other worker in a race. Both need a row the engine
    did not produce, which is the whole point of not going through it.

    `feed_timestamp` is the artifact's GTFS header time, and it is settable
    because the serving endpoint's `last_good` age cap is measured against it:
    a test for that has to place the artifact at a chosen distance from a
    frozen clock.
    """
    return PublishAttempt(
        org_slug=feed.org_slug,
        slug=feed.slug,
        binding_revision=feed.revision if binding_revision is None else binding_revision,
        query_result_id=query_result_id,
        decision=decision,
        reason="",
        feed_bytes=feed_bytes,
        feed_timestamp=feed_timestamp,
        findings=[],
        enabled_rules=["E003"],
        is_current=is_current,
    )


def returning(outcome: ValidationOutcome) -> Validate:
    """A validator that always answers the same way."""

    def validate(feed_bytes: bytes, static_ref: str, previous: bytes | None) -> ValidationOutcome:
        return outcome

    return validate


def run(db: Session, feed: PublishedFeed, outcome: ValidationOutcome, result_id: int = 100) -> AttemptResult:
    """One attempt over ROWS, with the clock supplied so nothing here is timing."""
    return run_attempt(db, feed, ROWS, query_result_id=result_id, feed_timestamp=1700, validate=returning(outcome))


def attempts(db: Session) -> list[PublishAttempt]:
    """Every recorded attempt, oldest first."""
    return list(db.execute(select(PublishAttempt).order_by(PublishAttempt.attempt_id)).scalars())
