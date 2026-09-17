from sqlalchemy import Engine
from sqlalchemy.orm import Session

from tests.publish_aggregate_stubs import (
    AGGREGATE_BYTES,
    AGGREGATE_ENTITY,
    AggregateProducer,
    aggregate_feed,
    publish_version,
)
from tests.publish_stubs import CLEAN, ERRORED, attempt_row, attempts, make_feed, run
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services.publish_engine import BINDING_RETIRED_REASON, current_artifact
from veodyn_api.services.publish_produce import Produced, Production, Refused, register_producer, restored_producers


def test_a_blocked_attempt_leaves_the_pointer_up_by_default(db: Session) -> None:
    feed = make_feed(db)
    run(db, feed, CLEAN, result_id=100)

    run(db, feed, ERRORED, result_id=200)

    served = current_artifact(db, feed)
    assert served is not None
    assert served.source_version == 100


def test_a_blocked_attempt_takes_a_retiring_feed_dark(db: Session) -> None:
    feed = make_feed(db, retire_on_failure=True)
    run(db, feed, CLEAN, result_id=100)

    run(db, feed, ERRORED, result_id=200)

    assert current_artifact(db, feed) is None
    assert [attempt.decision for attempt in attempts(db)] == ["published", "blocked"]


def test_a_producer_refusal_takes_a_retiring_feed_dark(db: Session) -> None:
    producer = AggregateProducer()
    with restored_producers():
        register_producer("gtfs-rt", AGGREGATE_ENTITY, producer)
        feed = aggregate_feed(db, retire_on_failure=True)
        assert publish_version(db, feed, 1).decision == "published"

        producer.refusal = "the source is unreadable"
        result = publish_version(db, feed, 2)

    assert result.decision == "failed"
    assert result.reason == "the source is unreadable"
    assert current_artifact(db, feed) is None


def test_an_out_of_order_attempt_does_not_retire_a_newer_artifact(db: Session) -> None:
    feed = make_feed(db, retire_on_failure=True)
    run(db, feed, CLEAN, result_id=200)

    result = run(db, feed, CLEAN, result_id=100)

    assert result.decision == "failed"
    served = current_artifact(db, feed)
    assert served is not None
    assert served.source_version == 200


def test_retiring_a_feed_does_not_lower_the_ordering_watermark(db: Session) -> None:
    producer = AggregateProducer()
    with restored_producers():
        register_producer("gtfs-rt", AGGREGATE_ENTITY, producer)
        feed = aggregate_feed(db, retire_on_failure=True)
        assert publish_version(db, feed, 200).decision == "published"

        producer.refusal = "the source is briefly unreadable"
        assert publish_version(db, feed, 300).decision == "failed"
        assert current_artifact(db, feed) is None

        producer.refusal = None
        older = publish_version(db, feed, 100)
        equal = publish_version(db, feed, 200)

    assert (older.decision, equal.decision) == ("failed", "failed")
    assert "not newer than the published 200" in older.reason
    assert "not newer than the published 200" in equal.reason
    assert current_artifact(db, feed) is None


def test_a_failing_attempt_does_not_retire_an_artifact_published_while_it_ran(db: Session, engine: Engine) -> None:
    feed = aggregate_feed(db, retire_on_failure=True)

    def publish_a_newer_artifact_and_then_refuse(production: Production) -> Produced:
        with Session(engine) as concurrent:
            concurrent.add(attempt_row(feed, query_result_id=500))
            concurrent.commit()
        raise Refused("the source is unreadable")

    with restored_producers():
        register_producer("gtfs-rt", AGGREGATE_ENTITY, publish_a_newer_artifact_and_then_refuse)
        result = publish_version(db, feed, 300)

    assert result.decision == "failed"
    served = current_artifact(db, feed)
    assert served is not None
    assert served.source_version == 500


def test_a_retired_binding_does_not_take_down_the_artifact_it_found_serving(db: Session, engine: Engine) -> None:
    producer = AggregateProducer()
    with restored_producers():
        register_producer("gtfs-rt", AGGREGATE_ENTITY, producer)
        feed = aggregate_feed(db, retire_on_failure=True)
        assert publish_version(db, feed, 100).decision == "published"
        with Session(engine) as concurrent:
            bound = concurrent.get(PublishedFeed, (feed.org_slug, feed.slug))
            assert bound is not None
            bound.revision += 1
            concurrent.commit()

        result = publish_version(db, feed, 300)

    assert result.decision == "failed"
    assert BINDING_RETIRED_REASON in result.reason
    served = current_artifact(db, feed)
    assert served is not None
    assert (served.binding_revision, served.source_version) == (1, 100)


def test_a_retired_binding_does_not_clear_the_replacement_revisions_artifact(db: Session, engine: Engine) -> None:
    feed = aggregate_feed(db, retire_on_failure=True)

    def rebind_and_publish_under_the_new_revision(production: Production) -> Produced:
        with Session(engine) as concurrent:
            bound = concurrent.get(PublishedFeed, (feed.org_slug, feed.slug))
            assert bound is not None
            bound.revision += 1
            replacement = bound.revision
            concurrent.add(attempt_row(feed, query_result_id=700, binding_revision=replacement))
            concurrent.commit()
        return CLEAN, AGGREGATE_BYTES, None

    with restored_producers():
        register_producer("gtfs-rt", AGGREGATE_ENTITY, rebind_and_publish_under_the_new_revision)
        result = publish_version(db, feed, 300)

    assert result.decision == "failed"
    assert BINDING_RETIRED_REASON in result.reason
    served = current_artifact(db, feed)
    assert served is not None
    assert (served.binding_revision, served.source_version) == (2, 700)
