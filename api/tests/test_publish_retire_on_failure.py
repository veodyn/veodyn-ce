"""The one setting that takes a feed dark, and everything it may not take down.

`retire_on_failure` is off for every binding shipping today. Turned on, a tick
that cannot confirm the content clears the served pointer, and the whole risk of
that is what ELSE a clear can reach: an artifact newer than the attempt doing the
clearing, one published by the revision that replaced this attempt's binding, and
the ordering watermark itself.
"""

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
    """The behaviour every feed shipping today relies on, asserted here as the
    control for the pair below: without it, a passing retire test proves only
    that the pointer was cleared by something."""
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
    """The other half of "the content could not be confirmed": the producer
    never got as far as a verdict, which for an aggregate means its source could
    not be read."""
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
    """A stale tick judges nothing about what is being served, and what is being
    served is NEWER than what the tick brought. Retiring there would take a
    healthy feed dark on every late worker tick."""
    feed = make_feed(db, retire_on_failure=True)
    run(db, feed, CLEAN, result_id=200)

    result = run(db, feed, CLEAN, result_id=100)

    assert result.decision == "failed"
    served = current_artifact(db, feed)
    assert served is not None
    assert served.source_version == 200


def test_retiring_a_feed_does_not_lower_the_ordering_watermark(db: Session) -> None:
    """The two halves of this change composed, which is where neither is safe
    alone: 200 is serving, 300 hits a transient producer refusal and takes the
    feed dark, and then a delayed 100 and a duplicate 200 arrive to find no
    current artifact at all. A watermark that lives on the served pointer went
    dark with it, and both of these publish stale bytes at an address that was
    taken off the air on purpose."""
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
    """The ordering guard clears an attempt at the START of its run. A newer one
    can publish while this one is still producing, so by the time this one fails
    the pointer belongs to a version it never judged."""
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
    """The refusal itself, isolated from what is being served. Everything the
    entitlement check looks at says this attempt could retire this artifact: same
    revision, and older than the attempt. What disqualifies it is only that the
    binding moved, which is a fact about the declaration and not about the feed's
    content, and this refusal is not the one that may act on it."""
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
    """The third refusal that judges nothing, and the only one that judges
    nothing about the BINDING: this attempt answers for a revision that no
    longer exists, and what is on the air was published by the revision that
    replaced it."""
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
