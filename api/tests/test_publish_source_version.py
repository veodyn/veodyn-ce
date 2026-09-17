import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.exc import StatementError
from sqlalchemy.orm import Session

from tests.publish_aggregate_stubs import (
    AGGREGATE_BYTES,
    AGGREGATE_ENTITY,
    AggregateProducer,
    aggregate_feed,
    never_validated,
    publish_version,
)
from tests.publish_stubs import CLEAN, ROWS, attempt_row, attempts, edit_binding, make_feed, run
from tests.published_feed_route_stubs import ADMIN, REDASH, as_user, auth
from veodyn_api.services.publish_engine import current_artifact, run_attempt
from veodyn_api.services.publish_produce import AlreadyRegistered, register_producer, restored_producers


def test_a_feed_with_no_query_publishes_from_a_registered_producer(db: Session) -> None:
    with restored_producers():
        register_producer("gtfs-rt", AGGREGATE_ENTITY, AggregateProducer())
        feed = aggregate_feed(db)

        result = publish_version(db, feed, 1)

    assert result.decision == "published"
    served = current_artifact(db, feed)
    assert served is not None
    assert served.feed_bytes == AGGREGATE_BYTES + b"1"
    assert served.query_result_id is None
    assert served.source_version == 1


def test_an_entity_nothing_registered_a_producer_for_is_a_failed_attempt(db: Session) -> None:
    feed = aggregate_feed(db)

    result = publish_version(db, feed, 1)

    assert result.decision == "failed"
    assert AGGREGATE_ENTITY in result.reason
    assert current_artifact(db, feed) is None


def test_an_attempt_with_neither_a_result_id_nor_a_version_is_refused_before_it_runs(db: Session) -> None:
    with restored_producers():
        register_producer("gtfs-rt", AGGREGATE_ENTITY, AggregateProducer())
        feed = aggregate_feed(db)

        with pytest.raises(ValueError):
            run_attempt(db, feed, ROWS, None, 1700, never_validated)

    assert attempts(db) == []


def test_a_second_producer_for_one_entity_is_refused() -> None:
    with restored_producers():
        register_producer("gtfs-rt", AGGREGATE_ENTITY, AggregateProducer())

        with pytest.raises(AlreadyRegistered):
            register_producer("gtfs-rt", AGGREGATE_ENTITY, AggregateProducer())


def test_a_producer_the_community_build_registered_cannot_be_replaced() -> None:
    with restored_producers():
        with pytest.raises(AlreadyRegistered):
            register_producer("gtfs-rt", "vehicle_positions", AggregateProducer())


def test_an_out_of_order_query_result_is_still_refused(db: Session) -> None:
    feed = make_feed(db)
    run(db, feed, CLEAN, result_id=200)

    result = run(db, feed, CLEAN, result_id=100)

    assert result.decision == "failed"
    assert "not newer" in result.reason
    served = current_artifact(db, feed)
    assert served is not None
    assert (served.query_result_id, served.source_version) == (200, 200)


def test_an_out_of_order_source_version_is_refused(db: Session) -> None:
    with restored_producers():
        register_producer("gtfs-rt", AGGREGATE_ENTITY, AggregateProducer())
        feed = aggregate_feed(db)
        assert publish_version(db, feed, 200).decision == "published"

        result = publish_version(db, feed, 100)

    assert result.decision == "failed"
    assert "not newer" in result.reason
    served = current_artifact(db, feed)
    assert served is not None
    assert served.source_version == 200


def test_the_same_source_version_twice_is_refused(db: Session) -> None:
    with restored_producers():
        register_producer("gtfs-rt", AGGREGATE_ENTITY, AggregateProducer())
        feed = aggregate_feed(db)
        assert publish_version(db, feed, 7).decision == "published"

        assert publish_version(db, feed, 7).decision == "failed"


def test_source_versions_are_not_compared_across_a_binding_edit(db: Session) -> None:
    with restored_producers():
        register_producer("gtfs-rt", AGGREGATE_ENTITY, AggregateProducer())
        feed = aggregate_feed(db)
        assert publish_version(db, feed, 900).decision == "published"
        edit_binding(db, feed, source_column="provider")

        result = publish_version(db, feed, 1)

    assert result.decision == "published"
    served = current_artifact(db, feed)
    assert served is not None
    assert (served.binding_revision, served.source_version) == (2, 1)


def test_the_default_source_version_is_the_inserted_query_result_id(db: Session) -> None:
    feed = make_feed(db)

    db.add(attempt_row(feed, query_result_id=4242))
    db.commit()

    assert [(a.query_result_id, a.source_version) for a in attempts(db)] == [(4242, 4242)]


def test_the_default_source_version_refuses_an_insert_with_no_query_result(db: Session) -> None:
    feed = make_feed(db)
    db.add(attempt_row(feed, query_result_id=None))

    with pytest.raises(StatementError) as refusal:
        db.commit()

    assert "pass it explicitly" in str(refusal.value)
    db.rollback()
    assert attempts(db) == []


@respx.mock
def test_the_manual_publish_route_refuses_a_feed_with_no_query(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    as_user(ADMIN)
    respx.get(f"{REDASH}/api/queries/42").mock(return_value=httpx.Response(500, json={"message": "never asked"}))
    aggregate_feed(db)

    response = api.post("/published-feeds/alerts/attempts", headers=auth())

    assert response.status_code == 422
    assert response.json()["error"]["id"] == "VEODYN_PUBLISHED_FEED_NO_RESULT"
    assert attempts(db) == []
