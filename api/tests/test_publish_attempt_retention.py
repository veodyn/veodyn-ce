from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError
from sqlalchemy import Select, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from tests.publish_stubs import ERRORED, attempt_row, attempts, make_feed, run
from veodyn_api.models.publish_attempt import PublishAttempt
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services import publish_retention
from veodyn_api.services.publish_record import published_feed_timestamp_high_water_mark, published_high_water_mark
from veodyn_api.services.publish_retention import (
    RetentionNeeds,
    register_retention_needs,
    restored_retention_needs,
)
from veodyn_api.settings import Settings, get_settings

RETENTION_ENV = "VEODYN_PUBLISH_ATTEMPT_RETENTION_DAYS"


def retain_for(monkeypatch: pytest.MonkeyPatch, days: str) -> None:
    monkeypatch.setenv(RETENTION_ENV, days)
    get_settings.cache_clear()


def aged(
    db: Session,
    feed: PublishedFeed,
    days: float,
    *,
    decision: str = "failed",
    is_current: bool = False,
    source_version: int = 1,
    feed_timestamp: int | None = None,
) -> int:
    row = attempt_row(
        feed,
        decision=decision,
        feed_bytes=b"\x01" if decision == "published" else None,
        is_current=is_current,
        query_result_id=source_version,
        feed_timestamp=feed_timestamp,
    )
    row.created_at = datetime.now(UTC) - timedelta(days=days)
    db.add(row)
    db.commit()
    return row.attempt_id


def surviving_ids(db: Session, feed: PublishedFeed) -> set[int]:
    return set(
        db.scalars(
            select(PublishAttempt.attempt_id).where(
                PublishAttempt.org_slug == feed.org_slug, PublishAttempt.slug == feed.slug
            )
        )
    )


def test_an_unset_retention_keeps_every_attempt(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(RETENTION_ENV, raising=False)
    get_settings.cache_clear()
    feed = make_feed(db)
    ancient = aged(db, feed, 400)

    run(db, feed, ERRORED)

    assert ancient in surviving_ids(db, feed)
    assert len(attempts(db)) == 2


@pytest.mark.parametrize("blank", ["", "   "])
def test_a_blank_retention_reads_as_unset(monkeypatch: pytest.MonkeyPatch, blank: str) -> None:
    monkeypatch.setenv(RETENTION_ENV, blank)

    assert Settings().publish_attempt_retention_days is None


def test_retention_is_read_as_whole_days(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(RETENTION_ENV, "30")

    assert Settings().publish_attempt_retention_days == 30


@pytest.mark.parametrize("refused", ["0", "-3", "a week"])
def test_a_retention_that_is_not_a_positive_day_count_is_refused(
    monkeypatch: pytest.MonkeyPatch, refused: str
) -> None:
    monkeypatch.setenv(RETENTION_ENV, refused)

    with pytest.raises(ValidationError):
        Settings()


def test_recording_an_attempt_prunes_the_feeds_expired_attempts(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    retain_for(monkeypatch, "7")
    feed = make_feed(db)
    expired = aged(db, feed, 10)
    recent = aged(db, feed, 3)

    run(db, feed, ERRORED)

    survivors = surviving_ids(db, feed)
    assert expired not in survivors
    assert recent in survivors
    assert len(survivors) == 2


def test_the_served_artifact_is_never_pruned_however_old(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    retain_for(monkeypatch, "7")
    feed = make_feed(db)
    served = aged(db, feed, 90, decision="published", is_current=True, source_version=50, feed_timestamp=1600)
    aged(db, feed, 95, decision="published", source_version=60, feed_timestamp=1700)

    result = run(db, feed, ERRORED)

    assert result.decision == "blocked"
    assert served in surviving_ids(db, feed)


def test_the_rows_the_ordering_guards_read_survive_a_prune(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    retain_for(monkeypatch, "7")
    feed = make_feed(db)
    superseded = aged(db, feed, 40, decision="published", source_version=10, feed_timestamp=1500)
    newest_version = aged(db, feed, 30, decision="published", source_version=20, feed_timestamp=1550)
    newest_header = aged(db, feed, 20, decision="published", source_version=15, feed_timestamp=1900)
    before = (published_high_water_mark(db, feed), published_feed_timestamp_high_water_mark(db, feed))

    run(db, feed, ERRORED, result_id=5)

    survivors = surviving_ids(db, feed)
    assert superseded not in survivors
    assert {newest_version, newest_header} <= survivors
    assert (published_high_water_mark(db, feed), published_feed_timestamp_high_water_mark(db, feed)) == before


def test_the_ordering_guard_is_kept_for_every_binding_revision(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    retain_for(monkeypatch, "7")
    feed = make_feed(db)
    first_revision = aged(db, feed, 40, decision="published", source_version=30, feed_timestamp=1500)
    feed.revision = 2
    db.commit()
    second_revision = aged(db, feed, 20, decision="published", source_version=3, feed_timestamp=1900)

    run(db, feed, ERRORED, result_id=5)

    assert {first_revision, second_revision} <= surviving_ids(db, feed)


def test_one_prune_deletes_at_most_one_batch(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    retain_for(monkeypatch, "7")
    monkeypatch.setattr(publish_retention, "PRUNE_BATCH_ROWS", 3)
    feed = make_feed(db)
    expired = [aged(db, feed, 10 + day) for day in range(5)]

    run(db, feed, ERRORED)
    after_one = surviving_ids(db, feed) & set(expired)
    run(db, feed, ERRORED, result_id=101)
    after_two = surviving_ids(db, feed) & set(expired)

    assert after_one == set(expired[3:])
    assert after_two == set()


def test_a_prune_never_reaches_another_feed(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    retain_for(monkeypatch, "7")
    feed = make_feed(db)
    other = make_feed(db, slug="trams")
    others_expired = aged(db, other, 10)

    run(db, feed, ERRORED)

    assert others_expired in surviving_ids(db, other)


def test_a_registered_history_need_lengthens_the_window(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    retain_for(monkeypatch, "1")
    feed = make_feed(db)
    inside_the_need = aged(db, feed, 10)
    past_the_need = aged(db, feed, 40)

    with restored_retention_needs():
        register_retention_needs(RetentionNeeds(history=timedelta(days=30)))
        run(db, feed, ERRORED)

    survivors = surviving_ids(db, feed)
    assert inside_the_need in survivors
    assert past_the_need not in survivors


def test_an_attempt_a_pack_keeps_is_not_pruned(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    retain_for(monkeypatch, "7")
    feed = make_feed(db)
    kept = aged(db, feed, 50)
    dropped = aged(db, feed, 40)

    def keeps(org_slug: str, slug: str) -> Select[tuple[int]]:
        return select(PublishAttempt.attempt_id).where(PublishAttempt.attempt_id == kept)

    with restored_retention_needs():
        register_retention_needs(RetentionNeeds(keeps=keeps))
        run(db, feed, ERRORED)

    survivors = surviving_ids(db, feed)
    assert kept in survivors
    assert dropped not in survivors


def test_a_pack_is_told_exactly_which_attempts_were_pruned(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    retain_for(monkeypatch, "7")
    feed = make_feed(db)
    expired = {aged(db, feed, 10), aged(db, feed, 11)}
    aged(db, feed, 2)
    told: list[tuple[str, str, set[int]]] = []

    def forgets(session: Session, org_slug: str, slug: str, attempt_ids: Sequence[int]) -> None:
        told.append((org_slug, slug, set(attempt_ids)))

    with restored_retention_needs():
        register_retention_needs(RetentionNeeds(forgets=forgets))
        run(db, feed, ERRORED)

    assert told == [(feed.org_slug, feed.slug, expired)]


def test_a_prune_with_nothing_expired_tells_no_pack(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    retain_for(monkeypatch, "7")
    feed = make_feed(db)
    told: list[Sequence[int]] = []

    def forgets(session: Session, org_slug: str, slug: str, attempt_ids: Sequence[int]) -> None:
        told.append(attempt_ids)

    with restored_retention_needs():
        register_retention_needs(RetentionNeeds(forgets=forgets))
        run(db, feed, ERRORED)

    assert told == []


def test_a_failed_prune_leaves_the_recorded_attempt_and_the_expired_rows(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    retain_for(monkeypatch, "7")
    feed = make_feed(db)
    expired = aged(db, feed, 10)

    def forgets(session: Session, org_slug: str, slug: str, attempt_ids: Sequence[int]) -> None:
        raise OperationalError("DELETE", {}, Exception("lock timeout"))

    with restored_retention_needs():
        register_retention_needs(RetentionNeeds(forgets=forgets))
        result = run(db, feed, ERRORED)

    assert result.decision == "blocked"
    assert expired in surviving_ids(db, feed)
    assert len(attempts(db)) == 2


def test_needs_registered_inside_the_block_do_not_outlive_it() -> None:
    before = publish_retention.registered_retention_needs()

    with restored_retention_needs():
        register_retention_needs(RetentionNeeds(history=timedelta(days=99)))

    assert publish_retention.registered_retention_needs() == before
