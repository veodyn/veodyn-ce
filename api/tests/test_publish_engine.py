"""One publish attempt: serialize, validate, decide.

What the engine decides and in what order it decides it. The artifact row those
decisions leave behind, and the constraints the database holds it to, are in
`test_publish_attempt_artifact.py`; what it decides when another worker or a
binding edit lands mid-attempt is in `test_publish_in_flight.py`.
"""

from sqlalchemy.orm import Session

from tests.publish_stubs import CLEAN, ERRORED, ROWS, UNCHECKED, UNSERIALIZABLE, WARNED, attempts, make_feed, run
from veodyn_api.services.publish_engine import current_artifact, run_attempt
from veodyn_api.services.published_feed_validator import ValidationOutcome, ValidatorUnavailable

# --- the verdict decides ---------------------------------------------------


def test_a_clean_feed_publishes(db: Session) -> None:
    result = run(db, make_feed(db), CLEAN)

    assert result.decision == "published"
    assert result.findings == ()


def test_an_error_blocks(db: Session) -> None:
    result = run(db, make_feed(db), ERRORED)

    assert result.decision == "blocked"
    assert result.findings[0].rule_id == "E003"


def test_warnings_alone_publish(db: Session) -> None:
    """A warning is a thing to fix, not a reason to take the feed off the air.

    It still travels with the result: a feed that published is not a feed with
    nothing to say about it, and dropping the warnings at the point of success
    is how a drift into non-conformance stays invisible until it blocks.
    """
    result = run(db, make_feed(db), WARNED)

    assert result.decision == "published"
    assert result.findings[0].severity == "WARNING"


# --- fail closed -----------------------------------------------------------


def test_a_validator_outage_fails_and_does_not_publish(db: Session) -> None:
    """An absent verdict is not a pass, and the pointer stays where it was.

    An empty finding list from a validator that never answered is
    indistinguishable from a clean feed, which is exactly why this branch may
    not produce one.
    """
    feed = make_feed(db)
    run(db, feed, CLEAN, result_id=100)

    def unavailable(feed_bytes: bytes, static_ref: str, previous: bytes | None) -> ValidationOutcome:
        raise ValidatorUnavailable("refused")

    result = run_attempt(db, feed, ROWS, query_result_id=200, feed_timestamp=1800, validate=unavailable)

    assert result.decision == "failed"
    assert "refused" in result.reason
    published = current_artifact(db, feed)
    assert published is not None
    assert published.query_result_id == 100


def test_a_blocked_attempt_does_not_move_the_pointer(db: Session) -> None:
    feed = make_feed(db)
    run(db, feed, CLEAN, result_id=100)

    run(db, feed, ERRORED, result_id=200)

    published = current_artifact(db, feed)
    assert published is not None
    assert published.query_result_id == 100


def test_a_first_attempt_that_blocks_publishes_nothing_at_all(db: Session) -> None:
    feed = make_feed(db)

    run(db, feed, ERRORED)

    assert current_artifact(db, feed) is None


# --- order: serialize first ------------------------------------------------


def test_a_serialization_failure_never_reaches_the_validator(db: Session) -> None:
    """A mapping defect must be named as one.

    Hand these bytes to a validator and it answers with whichever conformance
    rule the defect happens to trip, which sends the operator looking in the
    schedule for a fault that lives in the column map.
    """
    feed = make_feed(db)
    called: list[tuple[bytes, str, bytes | None]] = []

    def spy(feed_bytes: bytes, static_ref: str, previous: bytes | None) -> ValidationOutcome:
        called.append((feed_bytes, static_ref, previous))
        return CLEAN

    result = run_attempt(db, feed, UNSERIALIZABLE, query_result_id=100, feed_timestamp=1700, validate=spy)

    assert result.decision == "failed"
    assert called == []
    assert "latitude" in result.reason


def test_an_unsupported_entity_never_reaches_the_validator(db: Session) -> None:
    feed = make_feed(db, entity="trip_updates")
    called: list[str] = []

    def spy(feed_bytes: bytes, static_ref: str, previous: bytes | None) -> ValidationOutcome:
        called.append(static_ref)
        return CLEAN

    result = run_attempt(db, feed, ROWS, query_result_id=100, feed_timestamp=1700, validate=spy)

    assert result.decision == "failed"
    assert "trip_updates" in result.reason
    assert called == []


# --- attempts finish out of order ------------------------------------------


def test_an_older_result_never_regresses_the_pointer(db: Session) -> None:
    """A worker retrying a stale result after a fresher one landed is ordinary;
    serving it would walk the endpoint backwards."""
    feed = make_feed(db)
    run(db, feed, CLEAN, result_id=200)

    result = run(db, feed, CLEAN, result_id=100)

    assert result.decision == "failed"
    assert "not newer" in result.reason
    published = current_artifact(db, feed)
    assert published is not None
    assert published.query_result_id == 200


def test_the_same_result_twice_is_refused(db: Session) -> None:
    """Equal is not newer. The pointer does not churn over data that did not
    change, and `>` rather than `>=` is the whole difference."""
    feed = make_feed(db)
    run(db, feed, CLEAN, result_id=200)

    assert run(db, feed, CLEAN, result_id=200).decision == "failed"


def test_a_newer_result_moves_the_pointer_off_the_old_artifact(db: Session) -> None:
    feed = make_feed(db)
    run(db, feed, CLEAN, result_id=100)

    run(db, feed, CLEAN, result_id=200)

    published = current_artifact(db, feed)
    assert published is not None
    assert published.query_result_id == 200
    assert [attempt.is_current for attempt in attempts(db)] == [False, True]


# --- what the validator is handed ------------------------------------------


def test_the_previous_published_feed_is_offered_to_the_validator(db: Session) -> None:
    """The iteration rules compare against the artifact actually being
    replaced, not whatever file sorted before it."""
    feed = make_feed(db)
    run(db, feed, CLEAN, result_id=100)
    seen: dict[str, bytes | None] = {}

    def spy(feed_bytes: bytes, static_ref: str, previous: bytes | None) -> ValidationOutcome:
        seen["previous"] = previous
        return CLEAN

    run_attempt(db, feed, ROWS, query_result_id=200, feed_timestamp=1800, validate=spy)

    assert seen["previous"] is not None
    assert seen["previous"] == attempts(db)[0].feed_bytes


def test_a_first_attempt_is_offered_no_previous_feed(db: Session) -> None:
    seen: dict[str, bytes | None] = {"previous": b"sentinel"}

    def spy(feed_bytes: bytes, static_ref: str, previous: bytes | None) -> ValidationOutcome:
        seen["previous"] = previous
        return CLEAN

    run_attempt(db, make_feed(db), ROWS, query_result_id=100, feed_timestamp=1700, validate=spy)

    assert seen["previous"] is None


# --- a verdict from no rules is not a verdict ------------------------------


def test_a_verdict_from_zero_rules_does_not_publish(db: Session) -> None:
    """`validate` is injected, so the engine cannot lean on the real client's
    guarantee. An empty finding list from a rule set of nothing is
    indistinguishable from a clean feed and is not evidence about it."""
    feed = make_feed(db)

    result = run(db, feed, UNCHECKED)

    assert result.decision == "failed"
    assert "no enabled rules" in result.reason
    assert current_artifact(db, feed) is None


def test_a_verdict_from_zero_rules_does_not_move_a_pointer_that_is_already_up(db: Session) -> None:
    feed = make_feed(db)
    run(db, feed, CLEAN, result_id=100)

    assert run(db, feed, UNCHECKED, result_id=200).decision == "failed"
    published = current_artifact(db, feed)
    assert published is not None
    assert published.query_result_id == 100


def test_findings_from_zero_rules_are_refused_rather_than_blocked(db: Session) -> None:
    """A finding implies a rule that fired, so a report carrying one against an
    empty rule set is a validator contradicting itself, not a feed with a
    defect to name. The check runs before the severity does."""
    contradictory = ValidationOutcome(findings=ERRORED.findings, enabled_rules=())

    result = run(db, make_feed(db), contradictory)

    assert result.decision == "failed"
    assert "no enabled rules" in result.reason
