"""The production gbfs publisher, with nothing stubbed but the clock.

`test_publish_engine_gbfs.py` injects a `GbfsPublisher` to reach every branch of
the engine. These run the real one: real serializer, real gbfs-validator, real
origin. That is what catches the two halves agreeing with the plan and not with
each other, and it is why one pass per shape lives here.
"""

from sqlalchemy.orm import Session

from tests.publish_stubs import ROWS, gbfs_feed, never_called
from veodyn_api.services.publish_engine import current_artifact, run_attempt
from veodyn_api.services.publish_validator import build_gbfs_publisher
from veodyn_api.settings import Settings

STATION_MAP = {
    "station_id": "sid",
    "name": "nm",
    "lat": "lat",
    "lon": "lon",
    "num_vehicles_available": "bikes",
    "is_installed": "inst",
    "is_renting": "rent",
    "is_returning": "ret",
    "last_reported": "seen",
}
STATION_ROW = {
    "sid": "s1",
    "nm": "Main St",
    "lat": 34.05,
    "lon": -118.24,
    "bikes": 4,
    "inst": 1,
    "rent": 1,
    "ret": 1,
    "seen": 1755400000,
}

VEHICLE_MAP = {
    "vehicle_id": "vid",
    "lat": "y",
    "lon": "x",
    "is_reserved": "res",
    "is_disabled": "dis",
    "last_reported": "seen",
}
VEHICLE_ROW = {"vid": "v1", "y": 34.05, "x": -118.24, "res": 0, "dis": 0, "seen": 1755400000}

WIRED = Settings(feed_public_origin="https://veodyn.example")


def test_an_unset_public_origin_fails_the_attempt_rather_than_publishing(db: Session) -> None:
    """A deployment that cannot name its own public origin would otherwise publish
    a discovery document whose member urls point nowhere."""
    feed = gbfs_feed(db)
    unwired = build_gbfs_publisher(Settings(feed_public_origin=""))

    result = run_attempt(db, feed, ROWS, 1, 10, never_called, gbfs=unwired)

    assert result.decision == "failed"
    assert "VEODYN_FEED_PUBLIC_ORIGIN" in result.reason
    assert current_artifact(db, feed) is None


def test_a_stations_binding_publishes_a_docked_system(db: Session) -> None:
    feed = gbfs_feed(db, column_map=STATION_MAP)

    result = run_attempt(db, feed, [STATION_ROW], 1, 1755400100, never_called, gbfs=build_gbfs_publisher(WIRED))

    assert result.decision == "published", result.reason
    artifact = current_artifact(db, feed)
    assert artifact is not None and artifact.feed_files is not None
    feeds = artifact.feed_files["gbfs.json"]["data"]["en"]["feeds"]
    urls = {entry["name"]: entry["url"] for entry in feeds}
    assert urls["station_status"] == "https://veodyn.example/api/public/feeds/bikes/station_status.json"
    assert artifact.enabled_rules


def test_a_vehicles_binding_publishes_a_dockless_system(db: Session) -> None:
    """The other shape, judged by the validator's free-floating file table rather
    than the docked one."""
    feed = gbfs_feed(db, slug="scooters", entity="vehicles", column_map=VEHICLE_MAP)

    result = run_attempt(db, feed, [VEHICLE_ROW], 1, 1755400100, never_called, gbfs=build_gbfs_publisher(WIRED))

    assert result.decision == "published", result.reason
    artifact = current_artifact(db, feed)
    assert artifact is not None and artifact.feed_files is not None
    assert set(artifact.feed_files) == {"gbfs.json", "system_information.json", "free_bike_status.json"}
    assert artifact.feed_files["free_bike_status.json"]["data"]["bikes"][0]["bike_id"] == "v1"
    feeds = artifact.feed_files["gbfs.json"]["data"]["en"]["feeds"]
    urls = {entry["name"]: entry["url"] for entry in feeds}
    assert urls["free_bike_status"] == "https://veodyn.example/api/public/feeds/scooters/free_bike_status.json"


def test_an_entity_no_gbfs_shape_answers_to_is_refused_rather_than_published(db: Session) -> None:
    """A binding carried down from a build that registered more shapes. The
    refusal is a recorded failure, not a file set built to the wrong table."""
    feed = gbfs_feed(db, entity="docks")

    result = run_attempt(db, feed, ROWS, 1, 1755400100, never_called, gbfs=build_gbfs_publisher(WIRED))

    assert result.decision == "failed"
    assert "docks" in result.reason
    assert current_artifact(db, feed) is None
