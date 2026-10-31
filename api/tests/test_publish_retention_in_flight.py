from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import Engine, delete
from sqlalchemy.orm import Session

from tests.publish_stubs import CLEAN, ERRORED, ROWS, attempt_row, attempts, make_feed, returning
from veodyn_api.models.publish_attempt import PublishAttempt
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services import publish_record, published_feed_lifecycle
from veodyn_api.services.publish_engine import SUPERSEDED_REASON, current_artifact, run_attempt
from veodyn_api.services.publish_record import AttemptSource
from veodyn_api.services.published_feed_validator import ValidationOutcome
from veodyn_api.settings import get_settings


def an_old_served_artifact(db: Session, feed: PublishedFeed) -> int:
    row = attempt_row(feed, query_result_id=50, feed_timestamp=1600)
    row.created_at = datetime.now(UTC) - timedelta(days=90)
    db.add(row)
    db.commit()
    return row.attempt_id


def test_a_publish_whose_served_artifact_was_pruned_under_it_is_recorded_as_superseded(
    db: Session, engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("VEODYN_PUBLISH_ATTEMPT_RETENTION_DAYS", "7")
    get_settings.cache_clear()
    feed = make_feed(db)
    old = an_old_served_artifact(db, feed)
    current_artifact(db, feed)

    def a_winner_publishes_and_prunes(feed_bytes: bytes, static_ref: str, previous: bytes | None) -> ValidationOutcome:
        with Session(engine) as winner:
            bound = winner.get(PublishedFeed, (feed.org_slug, feed.slug))
            assert bound is not None
            run_attempt(winner, bound, ROWS, query_result_id=200, feed_timestamp=1800, validate=returning(CLEAN))
            assert winner.get(PublishAttempt, (feed.org_slug, feed.slug, old)) is None
        return CLEAN

    result = run_attempt(
        db, feed, ROWS, query_result_id=100, feed_timestamp=1700, validate=a_winner_publishes_and_prunes
    )

    assert (result.decision, result.reason) == ("failed", SUPERSEDED_REASON)
    served = current_artifact(db, feed)
    assert served is not None
    assert served.query_result_id == 200


def test_a_retirement_whose_served_artifact_was_pruned_under_it_still_records_the_attempt(
    db: Session, engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    feed = make_feed(db, retire_on_failure=True)
    old = an_old_served_artifact(db, feed)
    entitled = publish_record.the_artifact_this_attempt_is_entitled_to_retire

    def pruned_after_it_was_read(
        session: Session, bound: PublishedFeed, source: AttemptSource
    ) -> PublishAttempt | None:
        served = entitled(session, bound, source)
        with Session(engine) as pruner:
            pruner.execute(delete(PublishAttempt).where(PublishAttempt.attempt_id == old))
            pruner.commit()
        return served

    monkeypatch.setattr(publish_record, "the_artifact_this_attempt_is_entitled_to_retire", pruned_after_it_was_read)

    result = run_attempt(db, feed, ROWS, query_result_id=100, feed_timestamp=1700, validate=returning(ERRORED))

    assert result.decision == "blocked"
    assert current_artifact(db, feed) is None
    assert [row.decision for row in attempts(db)] == ["blocked"]


def test_deleting_a_binding_whose_served_artifact_was_pruned_under_it_still_deletes(
    db: Session, engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    feed = make_feed(db)
    old = an_old_served_artifact(db, feed)
    looked_up = published_feed_lifecycle.current_artifact

    def pruned_after_it_was_read(session: Session, bound: PublishedFeed) -> PublishAttempt | None:
        served = looked_up(session, bound)
        with Session(engine) as pruner:
            pruner.execute(delete(PublishAttempt).where(PublishAttempt.attempt_id == old))
            pruner.commit()
        return served

    monkeypatch.setattr(published_feed_lifecycle, "current_artifact", pruned_after_it_was_read)

    published_feed_lifecycle.take_the_feed_off_the_air(db, feed)
    db.delete(feed)
    db.commit()

    assert db.get(PublishedFeed, (feed.org_slug, feed.slug)) is None
