import json
from unittest import TestCase
from unittest.mock import patch

from redash.query_runner.gtfs_realtime import GtfsRealtime
from redash.query_runner.gtfs_realtime_entities import (
    parse_vehicle_entity,
    parse_vehicle_message,
)
from tests.query_runner.gtfs_realtime_fixtures import (
    build_feed_message,
    build_vehicle_entity,
    fake_response,
    fake_ws,
)

VEHICLE_QUERY = '{"resource": "vehicle_positions"}'
TYPED_COLUMNS = [
    ("vehicle_id", "string"),
    ("trip_id", "string"),
    ("route_id", "string"),
    ("line", "string"),
    ("latitude", "float"),
    ("longitude", "float"),
    ("bearing", "float"),
    ("speed", "float"),
    ("direction_id", "integer"),
    ("timestamp", "string"),
]


class TestTripIdParsing(TestCase):
    def test_protobuf_row_carries_trip_id(self):
        entity = build_vehicle_entity(entity_id="v1", vehicle_id="v1", trip_id="trip-9", route_id="10")
        self.assertEqual(parse_vehicle_entity(entity, {})["trip_id"], "trip-9")

    def test_protobuf_row_without_trip_id_is_null(self):
        entity = build_vehicle_entity(entity_id="v1", vehicle_id="v1", route_id="10")
        self.assertIsNone(parse_vehicle_entity(entity, {})["trip_id"])

    def test_protobuf_empty_trip_id_is_null(self):
        entity = build_vehicle_entity(entity_id="v1", vehicle_id="v1", trip_id="")
        self.assertIsNone(parse_vehicle_entity(entity, {})["trip_id"])

    def test_websocket_row_carries_trip_id(self):
        message = {
            "id": "v1",
            "vehicle": {"position": {"latitude": 1.0, "longitude": 2.0}, "trip": {"tripId": "trip-7"}},
        }
        self.assertEqual(parse_vehicle_message(message, {})["trip_id"], "trip-7")

    def test_websocket_row_without_trip_id_is_null(self):
        message = {"id": "v1", "vehicle": {"position": {"latitude": 1.0, "longitude": 2.0}, "trip": {}}}
        self.assertIsNone(parse_vehicle_message(message, {})["trip_id"])


class TestRunnerTripId(TestCase):
    def test_http_runner_returns_trip_id_column(self):
        runner = GtfsRealtime({"feed_url": "https://feed.example.org/vp"})
        entity = build_vehicle_entity(entity_id="v1", vehicle_id="v1", trip_id="trip-1", timestamp=1752940000)
        feed = build_feed_message([entity])
        with patch("redash.query_runner.gtfs_realtime.requests.get") as get:
            get.return_value = fake_response(feed.SerializeToString())
            data, error = runner.run_query(VEHICLE_QUERY, None)
        self.assertIsNone(error)
        self.assertEqual(data["rows"][0]["trip_id"], "trip-1")
        self.assertIn("trip_id", [c["name"] for c in data["columns"]])

    def test_websocket_runner_returns_trip_id(self):
        runner = GtfsRealtime({"feed_url": "wss://feed.example.org/ws"})
        message = {
            "id": "v1",
            "vehicle": {
                "position": {"latitude": 1.0, "longitude": 2.0},
                "trip": {"tripId": "trip-3"},
                "timestamp": 1752940000,
            },
        }
        with patch("redash.query_runner.gtfs_realtime.ws_connect", return_value=fake_ws([json.dumps(message)])):
            data, error = runner.run_query('{"resource": "vehicle_positions", "params": {"sample_seconds": 1}}', None)
        self.assertIsNone(error)
        self.assertEqual(data["rows"][0]["trip_id"], "trip-3")

    def test_empty_http_feed_yields_typed_columns(self):
        runner = GtfsRealtime({"feed_url": "https://feed.example.org/vp"})
        with patch("redash.query_runner.gtfs_realtime.requests.get") as get:
            get.return_value = fake_response(build_feed_message([]).SerializeToString())
            data, error = runner.run_query(VEHICLE_QUERY, None)
        self.assertIsNone(error)
        self.assertEqual(data["rows"], [])
        self.assertEqual([(c["name"], c["type"]) for c in data["columns"]], TYPED_COLUMNS)

    def test_empty_websocket_feed_yields_typed_columns(self):
        runner = GtfsRealtime({"feed_url": "wss://feed.example.org/ws"})
        with patch("redash.query_runner.gtfs_realtime.ws_connect", return_value=fake_ws([])):
            data, error = runner.run_query('{"resource": "vehicle_positions", "params": {"sample_seconds": 1}}', None)
        self.assertIsNone(error)
        self.assertEqual([(c["name"], c["type"]) for c in data["columns"]], TYPED_COLUMNS)

    def test_doc_returns_lists_trip_id(self):
        schema = GtfsRealtime({"feed_url": "https://feed.example.org/vp"}).get_schema()
        returns = next(e["columns"] for e in schema if e["name"] == "1. vehicle_positions > returns")
        self.assertTrue(any(entry.startswith("trip_id") for entry in returns))
