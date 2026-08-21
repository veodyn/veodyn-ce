from unittest import TestCase
from unittest.mock import patch

from redash.query_runner.gtfs_realtime import GtfsRealtime
from tests.query_runner.gtfs_realtime_fixtures import (
    build_feed_message,
    build_stop_time_update,
    build_trip_update_entity,
    fake_response,
)


class TestThresholdParamValidation(TestCase):
    def setUp(self):
        self.runner = GtfsRealtime(
            {
                "feed_url": "wss://feed.example.org/ws/vehicle_positions/{routes}",
                "trip_updates_url": "https://feed.example.org/gtfs-rt/trip_updates/{routes}",
            }
        )

    def _run(self, params):
        entity = build_trip_update_entity(
            entity_id="e",
            stop_time_updates=[build_stop_time_update(arrival_delay=0)],
        )
        feed = build_feed_message([], version="2.0")
        feed.entity.add().CopyFrom(entity)
        with patch("redash.query_runner.gtfs_realtime.requests.get") as get:
            get.return_value = fake_response(feed.SerializeToString())
            return self.runner.run_query(f'{{"resource": "trip_updates", "params": {params}}}', None)

    def test_boolean_early_seconds_rejected(self):
        data, error = self._run('{"early_seconds": true}')
        self.assertIsNone(data)
        self.assertIn("early_seconds", error)

    def test_negative_late_seconds_rejected(self):
        data, error = self._run('{"late_seconds": -1}')
        self.assertIsNone(data)
        self.assertIn("late_seconds", error)

    def test_non_numeric_early_seconds_rejected(self):
        data, error = self._run('{"early_seconds": "soon"}')
        self.assertIsNone(data)
        self.assertIn("early_seconds", error)

    def test_valid_thresholds_accepted(self):
        data, error = self._run('{"early_seconds": 30, "late_seconds": 120}')
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 1)

    def test_nan_early_seconds_rejected(self):
        data, error = self._run('{"early_seconds": NaN}')
        self.assertIsNone(data)
        self.assertIn("early_seconds", error)

    def test_nan_late_seconds_rejected(self):
        data, error = self._run('{"late_seconds": NaN}')
        self.assertIsNone(data)
        self.assertIn("late_seconds", error)

    def test_infinite_early_seconds_rejected(self):
        data, error = self._run('{"early_seconds": Infinity}')
        self.assertIsNone(data)
        self.assertIn("early_seconds", error)

    def test_infinite_late_seconds_rejected(self):
        data, error = self._run('{"late_seconds": Infinity}')
        self.assertIsNone(data)
        self.assertIn("late_seconds", error)


class TestUrlConfiguration(TestCase):
    def test_missing_trip_updates_url_raises_clear_error(self):
        runner = GtfsRealtime({"feed_url": "wss://feed.example.org/ws/vehicle_positions/{routes}"})
        data, error = runner.run_query('{"resource": "trip_updates"}', None)
        self.assertIsNone(data)
        self.assertIn("trip_updates requires the Trip updates URL to be configured on this data source", error)

    def test_whitespace_only_trip_updates_url_raises_clear_error(self):
        runner = GtfsRealtime(
            {
                "feed_url": "wss://feed.example.org/ws/vehicle_positions/{routes}",
                "trip_updates_url": "   ",
            }
        )
        data, error = runner.run_query('{"resource": "trip_updates"}', None)
        self.assertIsNone(data)
        self.assertIn("trip_updates requires the Trip updates URL to be configured on this data source", error)

    def test_websocket_trip_updates_url_raises_clear_error(self):
        runner = GtfsRealtime(
            {
                "feed_url": "wss://feed.example.org/ws/vehicle_positions/{routes}",
                "trip_updates_url": "wss://feed.example.org/ws/trip_updates/{routes}",
            }
        )
        data, error = runner.run_query('{"resource": "trip_updates"}', None)
        self.assertIsNone(data)
        self.assertIn("trip_updates supports HTTP protobuf feeds only", error)

    def test_ftp_trip_updates_url_raises_clear_error(self):
        runner = GtfsRealtime(
            {
                "feed_url": "wss://feed.example.org/ws/vehicle_positions/{routes}",
                "trip_updates_url": "ftp://feed.example.org/trip_updates/{routes}",
            }
        )
        with patch("redash.query_runner.gtfs_realtime.requests.get") as get:
            data, error = runner.run_query('{"resource": "trip_updates"}', None)
        self.assertIsNone(data)
        self.assertIn("trip_updates supports HTTP protobuf feeds only", error)
        get.assert_not_called()

    def test_http_trip_updates_url_fetches_and_substitutes_routes(self):
        runner = GtfsRealtime(
            {
                "feed_url": "wss://feed.example.org/ws/vehicle_positions/{routes}",
                "trip_updates_url": "https://feed.example.org/gtfs-rt/trip_updates/{routes}",
            }
        )
        feed = build_feed_message([])
        with patch("redash.query_runner.gtfs_realtime.requests.get") as get:
            get.return_value = fake_response(feed.SerializeToString())
            data, error = runner.run_query('{"resource": "trip_updates", "params": {"routes": "1, 2"}}', None)
        self.assertIsNone(error)
        self.assertEqual(data, {"columns": [], "rows": []})
        self.assertEqual(get.call_args.args[0], "https://feed.example.org/gtfs-rt/trip_updates/1,2")


class TestDocReturnsNullability(TestCase):
    """Guards the resource docs against understating on_time and matching how build_trip_update_rows
    actually computes it: null on any non-SCHEDULED stop relationship, not just SKIPPED."""

    def setUp(self):
        self.doc_returns = GtfsRealtime.resources["trip_updates"]["doc_returns"]

    def _entry(self, column):
        return next(line for line in self.doc_returns if line.startswith(f"{column}:"))

    def test_on_time_doc_covers_every_non_scheduled_stop_relationship_not_just_skipped(self):
        entry = self._entry("on_time")
        self.assertNotIn("skipped stop", entry.lower())
        self.assertIn("not SCHEDULED", entry)
        self.assertIn("CANCELED", entry)

    def test_nullable_columns_are_marked_nullable(self):
        for column in (
            "direction_id",
            "stop_sequence",
            "arrival_delay",
            "departure_delay",
            "arrival_time",
            "departure_time",
            "timestamp",
        ):
            self.assertIn("null", self._entry(column).lower(), f"{column} doc entry does not mention null")
