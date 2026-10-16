from unittest import TestCase
from unittest.mock import patch

from redash.query_runner.gtfs_realtime import GtfsRealtime
from redash.query_runner.gtfs_realtime_entities import (
    build_alert_row,
    build_trip_update_rows,
)
from redash.query_runner.gtfs_realtime_resources import EMPTY_COLUMNS
from tests.query_runner.gtfs_realtime_fixtures import (
    build_alert_entity,
    build_feed_message,
    build_stop_time_update,
    build_trip_update_entity,
    fake_response,
)

RUNNER_CONFIG = {
    "feed_url": "wss://feed.example.org/ws/vehicle_positions/{routes}",
    "trip_updates_url": "https://feed.example.org/gtfs-rt/trip_updates",
    "service_alerts_url": "https://feed.example.org/gtfs-rt/alerts",
}


def run_against_empty_feed(resource):
    feed = build_feed_message([])
    with patch("redash.query_runner.gtfs_realtime.requests.get") as get:
        get.return_value = fake_response(feed.SerializeToString())
        return GtfsRealtime(RUNNER_CONFIG).run_query(f'{{"resource": "{resource}"}}', None)


class TestEmptyFeedKeepsDeclaredColumns(TestCase):
    def test_service_alerts_with_no_active_alert_still_has_columns(self):
        data, error = run_against_empty_feed("service_alerts")
        self.assertIsNone(error)
        self.assertEqual(data["rows"], [])
        self.assertEqual([c["name"] for c in data["columns"]], list(EMPTY_COLUMNS["service_alerts"]))

    def test_trip_updates_with_no_trip_still_has_columns(self):
        data, error = run_against_empty_feed("trip_updates")
        self.assertIsNone(error)
        self.assertEqual(data["rows"], [])
        self.assertEqual([c["name"] for c in data["columns"]], list(EMPTY_COLUMNS["trip_updates"]))


class TestDeclaredColumnsMatchTheRowsTheyStandFor(TestCase):
    def test_service_alerts_declaration_matches_an_alert_row(self):
        row = build_alert_row(build_alert_entity(entity_id="a", header="h"))
        self.assertEqual(list(EMPTY_COLUMNS["service_alerts"]), list(row))

    def test_trip_updates_declaration_matches_a_trip_update_row(self):
        entity = build_trip_update_entity(entity_id="t", stop_time_updates=[build_stop_time_update(arrival_delay=0)])
        (row,) = build_trip_update_rows(entity, {}, 60, 300)
        self.assertEqual(list(EMPTY_COLUMNS["trip_updates"]), list(row))
