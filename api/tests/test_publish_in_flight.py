"""Attempts that overlap something else: another worker, or the binding itself.

`test_publish_engine.py` asserts what one attempt decides in isolation and
`test_publish_attempt_artifact.py` asserts the row it leaves behind. These
assert what happens when the world moves while an attempt is still in flight,
which a worker loop makes ordinary rather than exotic: the binding is loaded,
then serialization and a validator round trip run, and only afterwards does the
pointer move.

Every interleaving here is driven from inside the injected `validate`, using a
second `Session` on the same engine. That is the one moment that matters -- the
attempt has read the pointer and has not written its own row yet -- and
committing the competing transaction there makes the ordering deterministic
rather than leaving it to two threads to land in the order the assertion needs.
"""

from typing import Any

from sqlalchemy import Engine, event
from sqlalchemy.orm import Session

from tests.publish_stubs import CLEAN, ROWS, attempt_row, attempts, make_feed, retire_binding, run
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services.publish_engine import (
    BINDING_RETIRED_REASON,
    SUPERSEDED_REASON,
    Validate,
    current_artifact,
    run_attempt,
)
from veodyn_api.services.published_feed_validator import ValidationOutcome

# --- two workers, one feed -------------------------------------------------


def _racing(engine: Engine, feed: PublishedFeed, *, over: bool) -> ValidationOutcome:
    """Commit a competing publish from a second Session, then answer clean.

    Called from inside `validate`, which is the window the threaded probe hit:
    this attempt has already read the pointer and has not written its own row
    yet. `over` is whether the competitor is replacing an existing artifact or
    is itself the first publish.
    """
    with Session(engine) as winner:
        if over:
            existing = current_artifact(winner, feed)
            assert existing is not None
            existing.is_current = False
            winner.flush()
        winner.add(attempt_row(feed, query_result_id=300))
        winner.commit()
    return CLEAN


def test_a_concurrent_publish_records_the_loser_rather_than_raising(db: Session, engine: Engine) -> None:
    """Two overlapping worker ticks on one feed, with an artifact already up.

    Modelled rather than threaded, and deliberately: the competing publish is
    committed from a second Session at the one moment the threaded probe showed
    it mattering, so the interleaving is the same one (both read the pointer,
    one commits first, the other's INSERT collides on
    `uq_publish_attempt_current`) without depending on two threads landing in
    that order. `run_attempt` promises never to raise for an expected failure,
    and losing a race two workers were always allowed to run is one.
    """
    feed = make_feed(db)
    run(db, feed, CLEAN, result_id=100)

    def validate_then_race(feed_bytes: bytes, static_ref: str, previous: bytes | None) -> ValidationOutcome:
        return _racing(engine, feed, over=True)

    result = run_attempt(db, feed, ROWS, query_result_id=200, feed_timestamp=1700, validate=validate_then_race)

    assert result.decision == "failed"
    assert result.reason == SUPERSEDED_REASON
    # The winner is untouched: its row is still the only current one, and the
    # loser's rollback did not take the old pointer back with it.
    assert [(a.query_result_id, a.is_current) for a in attempts(db)] == [(100, False), (300, True), (200, False)]


def test_a_concurrent_first_publish_records_the_loser_rather_than_raising(db: Session, engine: Engine) -> None:
    """The same race with no artifact up yet, where neither worker has a pointer
    to clear and the collision is between two INSERTs alone."""
    feed = make_feed(db)

    def validate_then_race(feed_bytes: bytes, static_ref: str, previous: bytes | None) -> ValidationOutcome:
        return _racing(engine, feed, over=False)

    result = run_attempt(db, feed, ROWS, query_result_id=200, feed_timestamp=1700, validate=validate_then_race)

    assert result.decision == "failed"
    assert result.reason == SUPERSEDED_REASON
    assert [(a.query_result_id, a.is_current) for a in attempts(db)] == [(300, True), (200, False)]


def test_the_loser_of_a_race_stores_no_bytes(db: Session, engine: Engine) -> None:
    """It reached the publishing path with servable bytes in hand, which is the
    one place the recorded row could have picked them up."""
    feed = make_feed(db)

    def validate_then_race(feed_bytes: bytes, static_ref: str, previous: bytes | None) -> ValidationOutcome:
        return _racing(engine, feed, over=False)

    run_attempt(db, feed, ROWS, query_result_id=200, feed_timestamp=1700, validate=validate_then_race)

    loser = attempts(db)[-1]
    assert loser.decision == "failed"
    assert loser.feed_bytes is None


# --- the binding is retired under an attempt already running ---------------


def _retiring(engine: Engine, feed: PublishedFeed, *, delete: bool) -> Validate:
    """A validator that retires the binding from a second Session, then passes.

    A clean verdict on purpose. The attempt has to be refused because the
    binding it was serving is gone, not because anything was wrong with the
    bytes, so a verdict that would otherwise publish is the only one that tests
    the guard at all.
    """

    def validate(feed_bytes: bytes, static_ref: str, previous: bytes | None) -> ValidationOutcome:
        retire_binding(engine, feed, delete=delete)
        return CLEAN

    return validate


def test_a_binding_deleted_mid_attempt_is_not_put_back_on_air(db: Session, engine: Engine) -> None:
    """The sharper of the two, because `publish_attempt` has no foreign key to
    `published_feed`: a pointer set after the delete belongs to no binding at
    all, and the next feed to claim that slug inherits it before it has
    validated anything."""
    feed = make_feed(db)
    run(db, feed, CLEAN, result_id=100)
    validate = _retiring(engine, feed, delete=True)

    result = run_attempt(db, feed, ROWS, query_result_id=200, feed_timestamp=1800, validate=validate)

    assert result.decision == "failed"
    assert result.reason == f"{BINDING_RETIRED_REASON} (deleted)"
    assert current_artifact(db, feed) is None
    assert [a.decision for a in attempts(db)] == ["published", "failed"]


def test_a_binding_edited_mid_attempt_is_not_republished_from_the_old_mapping(db: Session, engine: Engine) -> None:
    """The edit took the feed dark on purpose, until an attempt revalidates
    under the new mapping. These bytes were built from the old one, so setting
    the pointer would undo the edit's decision with a tick that predates it."""
    feed = make_feed(db)
    run(db, feed, CLEAN, result_id=100)
    validate = _retiring(engine, feed, delete=False)

    result = run_attempt(db, feed, ROWS, query_result_id=200, feed_timestamp=1800, validate=validate)

    assert result.decision == "failed"
    assert result.reason == f"{BINDING_RETIRED_REASON} (edited to revision 2)"
    assert current_artifact(db, feed) is None


def test_the_refused_attempt_is_recorded_under_the_revision_it_ran_under(db: Session, engine: Engine) -> None:
    """The row is the trace of a tick that really happened, so it carries the
    revision the worker was handed rather than the one that displaced it. No
    bytes either: it got as far as the publishing path holding servable ones."""
    feed = make_feed(db)
    validate = _retiring(engine, feed, delete=False)

    run_attempt(db, feed, ROWS, query_result_id=200, feed_timestamp=1800, validate=validate)

    refused = attempts(db)[-1]
    assert (refused.binding_revision, refused.feed_bytes, refused.is_current) == (1, None, False)


def test_an_untouched_binding_still_publishes(db: Session, engine: Engine) -> None:
    """The guard costs an ordinary attempt nothing. A second Session reading the
    binding at the same moment, without retiring it, leaves the revision this
    attempt was handed exactly where it was."""
    feed = make_feed(db)
    run(db, feed, CLEAN, result_id=100)

    def validate_then_look(feed_bytes: bytes, static_ref: str, previous: bytes | None) -> ValidationOutcome:
        with Session(engine) as bystander:
            assert current_artifact(bystander, feed) is not None
        return CLEAN

    result = run_attempt(db, feed, ROWS, query_result_id=200, feed_timestamp=1800, validate=validate_then_look)

    assert result.decision == "published"
    published = current_artifact(db, feed)
    assert published is not None
    assert (published.query_result_id, published.binding_revision) == (200, 1)


def test_the_binding_is_locked_after_the_verdict_and_held_across_the_pointer_move(db: Session, engine: Engine) -> None:
    """Where the check sits, which no interleaving staged from here can show.

    The refusals above commit their retirement before the guard runs, so they
    pass just as well against a plain unlocked read taken at the top of
    `run_attempt` -- and that version still loses to a retirement that lands one
    moment later, because the gap is whatever runs after the check. Only the
    positioning rules it out, so the positioning is what is asserted: the
    `FOR UPDATE` is issued after the validator has answered, and the UPDATE that
    clears the old pointer and the INSERT that sets the new one both fall inside
    the lock rather than after it has been given back.
    """
    emitted: list[str] = []

    def record(conn: Any, cursor: Any, statement: str, parameters: Any, context: Any, many: Any) -> None:
        emitted.append(" ".join(statement.split()))

    feed = make_feed(db)
    run(db, feed, CLEAN, result_id=100)
    answered_at: list[int] = []

    def spy(feed_bytes: bytes, static_ref: str, previous: bytes | None) -> ValidationOutcome:
        answered_at.append(len(emitted))
        return CLEAN

    event.listen(engine, "before_cursor_execute", record)
    try:
        result = run_attempt(db, feed, ROWS, query_result_id=200, feed_timestamp=1800, validate=spy)
    finally:
        event.remove(engine, "before_cursor_execute", record)

    assert result.decision == "published"
    locks = [i for i, sql in enumerate(emitted) if "FROM published_feed" in sql and "FOR UPDATE" in sql]
    clears = [i for i, sql in enumerate(emitted) if sql.startswith("UPDATE publish_attempt")]
    inserts = [i for i, sql in enumerate(emitted) if sql.startswith("INSERT INTO publish_attempt")]
    assert len(locks) == 1
    assert answered_at[0] <= locks[0] < clears[0] < inserts[0]
