from sqlalchemy.orm import Session

from tests.publish_stubs import attempts, make_feed
from veodyn_api.services import published_feed_registry
from veodyn_api.services.publish_engine import current_artifact, run_attempt
from veodyn_api.services.publish_produce import entities_of_standard, producer_for
from veodyn_api.services.published_feed_validator import ValidationOutcome

ALERTS = "service_alerts"


def never_validated(feed_bytes: bytes, static_ref: str, previous: bytes | None) -> ValidationOutcome:
    raise AssertionError("nothing in a community build produces this feed")


def an_alert_binding(db: Session) -> object:
    return make_feed(db, slug="alerts", query_id=None, entity=ALERTS, column_map={}, retire_on_failure=True)


def test_the_engine_knows_the_name() -> None:
    assert ALERTS in entities_of_standard("gtfs-rt")


def test_a_community_build_registers_no_producer_for_it() -> None:
    assert producer_for("gtfs-rt", ALERTS) is None


def test_a_community_build_lets_no_binding_name_it() -> None:
    assert published_feed_registry.is_registered(ALERTS, "gtfs-rt") is False


def test_an_attempt_says_the_layer_is_missing_rather_than_the_name(db: Session) -> None:
    feed = an_alert_binding(db)

    result = run_attempt(db, feed, [], None, 1_756_000_000, never_validated, source_version=1)

    assert result.decision == "failed"
    assert result.reason == "entity 'service_alerts' has no producer installed in this deployment"
    assert current_artifact(db, feed) is None
    assert len(attempts(db)) == 1


def test_a_name_the_engine_has_never_heard_of_is_told_apart_from_that(db: Session) -> None:
    feed = make_feed(db, slug="bulletins", query_id=None, entity="bulletins", column_map={})

    result = run_attempt(db, feed, [], None, 1_756_000_000, never_validated, source_version=1)

    assert result.reason == "entity 'bulletins' is not supported yet"
