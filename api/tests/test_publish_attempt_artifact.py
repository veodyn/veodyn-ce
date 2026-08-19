"""The artifact row: what an attempt records, which binding it belongs to, and
what the database refuses.

`test_publish_engine.py` asserts what the engine decides and in what order.
These assert the artifact's own identity -- (binding revision, query_result_id)
-- and the pointer that identity is served through, which is where the revision
boundary lives: the served pointer is per feed, while everything that compares
one artifact to the next holds only within a revision. What happens when
another worker or a binding edit lands mid-attempt is in
`test_publish_in_flight.py`.

The two constraints here are held by Postgres rather than by the engine on
purpose: a rule kept only in application code is a rule every future writer has
to remember, and the writer that forgets is a raw INSERT.
"""

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tests.publish_stubs import (
    CLEAN,
    ERRORED,
    ROWS,
    UNSERIALIZABLE,
    attempt_row,
    attempts,
    edit_binding,
    make_feed,
    returning,
    run,
)
from veodyn_api.services.publish_engine import current_artifact, run_attempt
from veodyn_api.services.published_feed_validator import ValidationOutcome


def test_a_blocked_attempt_is_recorded_with_its_findings(db: Session) -> None:
    run(db, make_feed(db), ERRORED)

    stored = attempts(db)[0]
    assert stored.decision == "blocked"
    assert stored.findings[0]["ruleId"] == "E003"
    assert stored.findings[0]["locator"] == "vehicle_id b1 trip_id GHOST"
    # A verdict has to state what it covered, so the rule set is kept even on
    # the attempt that did not pass: a rule that never ran is not one that did.
    assert stored.enabled_rules == ["E003"]


def test_only_a_published_attempt_stores_bytes(db: Session) -> None:
    """A blocked or failed attempt holding servable bytes is one query away
    from being served, which is the thing blocking it was for."""
    feed = make_feed(db)
    run(db, feed, ERRORED, result_id=100)
    run_attempt(db, feed, UNSERIALIZABLE, query_result_id=200, feed_timestamp=1700, validate=returning(CLEAN))
    run(db, feed, CLEAN, result_id=300)

    stored = attempts(db)
    assert [attempt.decision for attempt in stored] == ["blocked", "failed", "published"]
    assert [attempt.feed_bytes is None for attempt in stored] == [True, True, False]


def test_bytes_on_a_blocked_row_are_refused_by_the_database(db: Session) -> None:
    """The engine passes None on every path but one. This is the check that
    catches the writer who does not."""
    feed = make_feed(db)

    db.add(attempt_row(feed, decision="blocked", is_current=False))
    with pytest.raises(IntegrityError):
        db.commit()


def test_two_current_attempts_for_one_feed_are_refused(db: Session) -> None:
    """One current artifact per feed, enforced by a partial unique index rather
    than by every writer clearing the old pointer first."""
    feed = make_feed(db)
    run(db, feed, CLEAN, result_id=100)

    db.add(attempt_row(feed))
    with pytest.raises(IntegrityError):
        db.commit()


def test_many_non_current_attempts_for_one_feed_coexist(db: Session) -> None:
    """The index is partial, and that is the half a `Boolean("is_current")`
    predicate loses. A full unique index on (org_slug, slug) would refuse the
    second attempt for a feed whatever its decision, which is every retry after
    the first failure."""
    feed = make_feed(db)
    for result_id in (100, 200, 300):
        run(db, feed, ERRORED, result_id=result_id)

    assert [attempt.decision for attempt in attempts(db)] == ["blocked", "blocked", "blocked"]


def test_the_same_slug_in_two_orgs_publishes_independently(db: Session) -> None:
    """The pointer index is keyed by org too, so one tenant publishing does not
    take another tenant's feed off the air."""
    acme = make_feed(db)
    other = make_feed(db, org_slug="other")

    run(db, acme, CLEAN, result_id=100)
    run(db, other, CLEAN, result_id=100)

    assert [(a.org_slug, a.is_current) for a in attempts(db)] == [("acme", True), ("other", True)]


# --- the pointer is per feed, not per revision -----------------------------


def test_a_publish_clears_the_pointer_left_by_an_older_revision(db: Session) -> None:
    """The index is on (org_slug, slug) and says nothing about the revision, so
    the row a publish clears is whichever one is current -- including one built
    from a column map the binding no longer has. Scope that lookup to the
    current revision and this attempt hits `uq_publish_attempt_current`."""
    feed = make_feed(db)
    run(db, feed, CLEAN, result_id=100)
    edit_binding(db, feed, query_id=99)

    result = run(db, feed, CLEAN, result_id=300)

    assert result.decision == "published"
    assert [(a.binding_revision, a.is_current) for a in attempts(db)] == [(1, False), (2, True)]


def test_an_artifact_of_an_older_revision_is_not_offered_as_the_previous_feed(db: Session) -> None:
    """The iteration rules compare consecutive feeds, and two feeds built from
    two different column maps are not two versions of one feed. An artifact
    from before the edit is no more the predecessor of this one than any other
    file would be, and offering it invents drift that is not there."""
    feed = make_feed(db)
    run(db, feed, CLEAN, result_id=100)
    edit_binding(db, feed, column_map={"vehicle_id": "bus", "latitude": "lat", "longitude": "lon"})
    seen: dict[str, bytes | None] = {"previous": b"sentinel"}

    def spy(feed_bytes: bytes, static_ref: str, previous: bytes | None) -> ValidationOutcome:
        seen["previous"] = previous
        return CLEAN

    run_attempt(db, feed, ROWS, query_result_id=200, feed_timestamp=1800, validate=spy)

    assert seen["previous"] is None
    # Still served, though. Nothing here takes the feed off the air.
    assert current_artifact(db, feed) is not None


def test_the_previous_feed_is_offered_again_once_this_revision_has_published(db: Session) -> None:
    """Scoping that lookup to the revision does not switch the iteration rules
    off; it waits until there is a predecessor they can honestly compare."""
    feed = make_feed(db)
    run(db, feed, CLEAN, result_id=100)
    edit_binding(db, feed, query_id=99)
    run(db, feed, CLEAN, result_id=200)
    seen: dict[str, bytes | None] = {}

    def spy(feed_bytes: bytes, static_ref: str, previous: bytes | None) -> ValidationOutcome:
        seen["previous"] = previous
        return CLEAN

    run_attempt(db, feed, ROWS, query_result_id=300, feed_timestamp=1900, validate=spy)

    assert seen["previous"] == attempts(db)[1].feed_bytes


def test_a_lower_result_id_from_a_new_lineage_is_not_stale(db: Session) -> None:
    """`query_result_id` is a row id in one query's result history, ordered
    against nothing else. Repoint the binding at another query and the first
    result it produces can carry a lower id than the artifact it replaces;
    refusing that compares two lineages and wedges the feed for good."""
    feed = make_feed(db)
    run(db, feed, CLEAN, result_id=900)
    edit_binding(db, feed, query_id=99)

    result = run(db, feed, CLEAN, result_id=100)

    assert result.decision == "published"
    published = current_artifact(db, feed)
    assert published is not None
    assert (published.binding_revision, published.query_result_id) == (2, 100)


def test_staleness_still_refuses_an_older_result_within_one_revision(db: Session) -> None:
    """The guard is narrowed to one lineage, not removed. Same revision, same
    query, so the ids are comparable and the older one is a regression."""
    feed = make_feed(db)
    edit_binding(db, feed, query_id=99)
    run(db, feed, CLEAN, result_id=900)

    result = run(db, feed, CLEAN, result_id=100)

    assert result.decision == "failed"
    assert "not newer" in result.reason
