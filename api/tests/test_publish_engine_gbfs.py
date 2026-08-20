"""The engine's gbfs branch: what it serializes, what it validates, what it
records, and every way it refuses to publish.

`GbfsPublisher` is injected exactly as `validate` is, so none of this needs a
validator or a network. The gtfs-rt verdicts in `publish_stubs` are reused
wholesale: a verdict is a verdict whichever standard produced it.
"""

from typing import Any

import pytest
from sqlalchemy.orm import Session

from tests.publish_stubs import CLEAN, ERRORED, ROWS, UNCHECKED, gbfs_feed, make_feed, never_called
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services.gtfs_rt_serializer import SerializationError
from veodyn_api.services.publish_engine import GbfsPublisher, current_artifact, run_attempt
from veodyn_api.services.published_feed_validator import ValidationOutcome, ValidatorUnavailable

FILES: dict[str, Any] = {
    "gbfs.json": {"last_updated": 1, "ttl": 0, "version": "2.3", "data": {"en": {"feeds": []}}},
    "station_status.json": {"last_updated": 1, "ttl": 0, "version": "2.3", "data": {"stations": []}},
}

# So `files=None` can mean "produced nothing" rather than "use the default".
_DEFAULT = object()


def publisher(
    *,
    files: Any = _DEFAULT,
    outcome: ValidationOutcome = CLEAN,
    serialize_error: Exception | None = None,
    validate_error: Exception | None = None,
) -> GbfsPublisher:
    def serialize(rows: list[dict[str, Any]], feed: PublishedFeed, feed_timestamp: int) -> dict[str, Any]:
        if serialize_error is not None:
            raise serialize_error
        return FILES if files is _DEFAULT else files

    def validate(produced: dict[str, Any], version: str, shape: str) -> ValidationOutcome:
        if validate_error is not None:
            raise validate_error
        return outcome

    return GbfsPublisher(serialize=serialize, validate=validate)


def test_a_clean_gbfs_attempt_publishes_files_and_no_bytes(db: Session) -> None:
    feed = gbfs_feed(db)

    result = run_attempt(db, feed, ROWS, 1, 10, never_called, gbfs=publisher())

    assert result.decision == "published"
    artifact = current_artifact(db, feed)
    assert artifact is not None
    assert artifact.feed_files == FILES
    assert artifact.feed_bytes is None
    assert artifact.feed_timestamp == 10


def test_a_worker_with_no_publisher_fails_closed(db: Session) -> None:
    """The enterprise worker calls run_attempt positionally and will not pass a
    publisher until it is re-cut. Until then a gbfs feed must record a failure,
    never raise and never publish."""
    feed = gbfs_feed(db)

    result = run_attempt(db, feed, ROWS, 1, 10, never_called)

    assert result.decision == "failed"
    assert "gbfs" in result.reason
    assert current_artifact(db, feed) is None


def test_a_serialization_fault_never_reaches_the_validator(db: Session) -> None:
    def exploding_validate(produced: dict[str, Any], version: str, shape: str) -> ValidationOutcome:
        raise AssertionError("a mapping fault must be named before any rule runs")

    broken = GbfsPublisher(
        serialize=lambda rows, feed, stamp: (_ for _ in ()).throw(SerializationError("row 0: lat is blank")),
        validate=exploding_validate,
    )
    feed = gbfs_feed(db)

    result = run_attempt(db, feed, ROWS, 1, 10, never_called, gbfs=broken)

    assert result.decision == "failed"
    assert result.reason == "row 0: lat is blank"


def test_the_validator_is_told_the_files_the_version_and_the_shape(db: Session) -> None:
    """The shape is the third argument and decides which member files the
    validator requires of the set, so a publisher handed only the version would
    judge a dockless feed against the docked table."""
    seen: list[tuple[dict[str, Any], str, str]] = []

    def spying_validate(produced: dict[str, Any], version: str, shape: str) -> ValidationOutcome:
        seen.append((produced, version, shape))
        return CLEAN

    feed = gbfs_feed(db, slug="scooters", entity="vehicles", version="3.0")
    watched = GbfsPublisher(serialize=lambda rows, binding, stamp: FILES, validate=spying_validate)

    result = run_attempt(db, feed, ROWS, 1, 10, never_called, gbfs=watched)

    assert result.decision == "published", result.reason
    assert seen == [(FILES, "3.0", "vehicles")]


def test_an_unavailable_validator_is_a_failure_not_a_pass(db: Session) -> None:
    feed = gbfs_feed(db)
    unavailable = publisher(validate_error=ValidatorUnavailable("gbfs validator returned no summary object"))

    result = run_attempt(db, feed, ROWS, 1, 10, never_called, gbfs=unavailable)

    assert result.decision == "failed"
    assert current_artifact(db, feed) is None


def test_a_verdict_from_no_rules_covers_nothing(db: Session) -> None:
    """UNCHECKED is shaped exactly like CLEAN apart from its empty rule list,
    which is the whole reason the engine checks it separately."""
    feed = gbfs_feed(db)

    result = run_attempt(db, feed, ROWS, 1, 10, never_called, gbfs=publisher(outcome=UNCHECKED))

    assert result.decision == "failed"
    assert current_artifact(db, feed) is None


def test_findings_block_and_keep_the_artifact_off_the_air(db: Session) -> None:
    feed = gbfs_feed(db)

    result = run_attempt(db, feed, ROWS, 1, 10, never_called, gbfs=publisher(outcome=ERRORED))

    assert result.decision == "blocked"
    assert result.findings == ERRORED.findings
    assert current_artifact(db, feed) is None


@pytest.mark.parametrize("produced", [{}, None])
def test_a_serializer_that_produced_nothing_is_a_failure_not_a_500(db: Session, produced: Any) -> None:
    """Reaching the shared tail with no artifact records `published` against a
    row the CHECK rejects, which surfaces as a 500 rather than a failed attempt."""
    feed = gbfs_feed(db)

    result = run_attempt(db, feed, ROWS, 1, 10, never_called, gbfs=publisher(files=produced))

    assert result.decision == "failed"
    assert current_artifact(db, feed) is None


def test_an_unsupported_gbfs_entity_is_refused(db: Session) -> None:
    """`docks` is a shape GBFS has no file for, and one a pack could still
    register: the engine publishes only what it can serialize."""
    feed = gbfs_feed(db, entity="docks")

    result = run_attempt(db, feed, ROWS, 1, 10, never_called, gbfs=publisher())

    assert result.decision == "failed"
    assert "docks" in result.reason


def test_an_older_query_result_is_refused_for_gbfs_too(db: Session) -> None:
    """The ordering guard is shared, so it has to hold for the standard that did
    not have it written for it."""
    feed = gbfs_feed(db)
    assert run_attempt(db, feed, ROWS, 5, 10, never_called, gbfs=publisher()).decision == "published"

    result = run_attempt(db, feed, ROWS, 4, 20, never_called, gbfs=publisher())

    assert result.decision == "failed"
    artifact = current_artifact(db, feed)
    assert artifact is not None and artifact.query_result_id == 5


def test_a_gtfs_rt_feed_is_unaffected_by_the_publisher_argument(db: Session) -> None:
    """The gtfs-rt path must not consult the publisher at all, even when one is
    passed, which is what a worker publishing both standards will do."""
    feed = make_feed(db)

    def validate(feed_bytes: bytes, ref: str, previous: bytes | None) -> ValidationOutcome:
        return CLEAN

    result = run_attempt(db, feed, ROWS, 1, 10, validate, gbfs=publisher())

    assert result.decision == "published"
    artifact = current_artifact(db, feed)
    assert artifact is not None
    assert artifact.feed_bytes is not None
    assert artifact.feed_files is None


@pytest.mark.parametrize("standard", ["siri", ""])
def test_an_unknown_standard_is_refused_rather_than_treated_as_gtfs_rt(db: Session, standard: str) -> None:
    # Neither artifact-shaped column, which is what the two CHECKs require of a
    # standard that is neither gtfs-rt nor gbfs.
    feed = gbfs_feed(db, standard=standard, system_info=None, static_gtfs_ref=None)

    result = run_attempt(db, feed, ROWS, 1, 10, never_called, gbfs=publisher())

    assert result.decision == "failed"
