import json
from unittest import TestCase
from unittest.mock import patch

from redash.query_runner.gtfs_realtime import GtfsRealtime
from redash.query_runner.gtfs_realtime_entities import parse_vehicle_message
from tests.query_runner.gtfs_realtime_fixtures import (
    MSG_A,
    MSG_A_NEWER,
    MSG_B,
    ROUTE_LABELS,
    SAMPLE_VEHICLE_MESSAGE_ROUTE_42,
    fake_ws,
)


def test_route_labels_come_from_configuration():
    labels = {"42": "Green Line"}
    row = parse_vehicle_message(SAMPLE_VEHICLE_MESSAGE_ROUTE_42, labels)
    assert row["line"] == "Green Line"


def test_unknown_route_keeps_the_code_verbatim():
    row = parse_vehicle_message(SAMPLE_VEHICLE_MESSAGE_ROUTE_42, {})
    assert row["line"] == "42"


class TestParseVehicleMessage(TestCase):
    def test_normalization(self):
        parsed = parse_vehicle_message(SAMPLE_VEHICLE_MESSAGE_ROUTE_42, {"42": "Green Line"})
        self.assertEqual(parsed["vehicle_id"], "9000-1")
        self.assertEqual(parsed["route_id"], "42")
        self.assertEqual(parsed["line"], "Green Line")
        self.assertEqual(parsed["latitude"], 10.0)
        self.assertEqual(parsed["direction_id"], 1)
        self.assertTrue(parsed["timestamp"].startswith("2025-") or parsed["timestamp"].startswith("2026-"))

    def test_missing_position_returns_none(self):
        self.assertIsNone(parse_vehicle_message({"id": "x", "vehicle": {}}, {}))

    def test_unknown_route_code_kept_verbatim(self):
        self.assertEqual(parse_vehicle_message(SAMPLE_VEHICLE_MESSAGE_ROUTE_42, {})["line"], "42")


class TestGtfsRealtime(TestCase):
    def setUp(self):
        self.runner = GtfsRealtime(
            {
                "feed_url": "wss://feed.example.org/ws/vehicle_positions/{routes}",
                "route_labels": json.dumps(ROUTE_LABELS),
                "sample_seconds": 5,
            }
        )

    def test_sampling_dedupes_by_vehicle_keeping_newest(self):
        messages = [json.dumps(MSG_A), "not json", json.dumps(MSG_B), json.dumps(MSG_A_NEWER)]
        with patch("redash.query_runner.gtfs_realtime.ws_connect", return_value=fake_ws(messages)) as connect:
            data, error = self.runner.run_query(
                '{"resource": "vehicle_positions", "params": {"routes": "10,20"}}', None
            )

        self.assertIsNone(error)
        rows = data["rows"]
        self.assertEqual(len(rows), 2)
        by_id = {row["vehicle_id"]: row for row in rows}
        self.assertEqual(by_id["1150-1161"]["latitude"], 10.06)  # newer update won
        self.assertEqual(by_id["2200-1"]["line"], "Green Line")
        self.assertNotIn("_ts", rows[0])

        url = connect.call_args.args[0]
        self.assertEqual(url, "wss://feed.example.org/ws/vehicle_positions/10,20")

    def test_feed_url_routes_param(self):
        with patch("redash.query_runner.gtfs_realtime.ws_connect", return_value=fake_ws([])) as connect:
            data, error = self.runner.run_query('{"resource": "vehicle_positions", "params": {"routes": "42"}}', None)

        self.assertIsNone(error)
        self.assertEqual(data, {"columns": [], "rows": []})
        self.assertEqual(connect.call_args.args[0], "wss://feed.example.org/ws/vehicle_positions/42")

    def test_connect_error_returned_as_query_error(self):
        with patch("redash.query_runner.gtfs_realtime.ws_connect", side_effect=OSError("connection refused")):
            data, error = self.runner.run_query('{"resource": "vehicle_positions"}', None)

        self.assertIsNone(data)
        self.assertIn("connection refused", error)


class TestWsDependencyMissing(TestCase):
    def test_ws_fetch_without_websockets_raises_a_clear_error(self):
        runner = GtfsRealtime({"feed_url": "wss://feed.example.org/ws/vehicle_positions/{routes}"})
        with patch("redash.query_runner.gtfs_realtime.ws_available", False):
            data, error = runner.run_query('{"resource": "vehicle_positions"}', None)
        self.assertIsNone(data)
        self.assertIn("websockets", error)


class TestSchemaBrowser(TestCase):
    """
    get_schema() reads meta["doc_params"]/meta["doc_returns"] (BaseResourceRunner,
    connector_base.py), not "params"/"returns"/"description". A resources dict using
    the wrong keys silently produces an empty params node and no returns node at all,
    while every sibling connector still shows both, so this must not regress.
    """

    def test_vehicle_positions_params_and_returns_are_populated(self):
        runner = GtfsRealtime({"feed_url": "wss://feed.example.org/ws/vehicle_positions/{routes}"})
        schema = runner.get_schema()
        by_name = {entry["name"]: entry["columns"] for entry in schema}

        params = by_name.get("1. vehicle_positions > params")
        self.assertTrue(params, "vehicle_positions > params node missing or empty")

        returns = by_name.get("1. vehicle_positions > returns")
        self.assertTrue(returns, "vehicle_positions > returns node missing or empty")
        for field in (
            "vehicle_id",
            "route_id",
            "line",
            "latitude",
            "longitude",
            "bearing",
            "speed",
            "direction_id",
            "timestamp",
        ):
            self.assertTrue(
                any(field in entry for entry in returns),
                f"{field!r} missing from vehicle_positions > returns",
            )


class TestRouteLabelsConfiguration(TestCase):
    def test_invalid_json_raises_a_clear_error(self):
        with self.assertRaises(ValueError) as ctx:
            GtfsRealtime({"feed_url": "wss://feed.example.org/ws/vehicle_positions/{routes}", "route_labels": "{"})
        self.assertIn("route_labels is not valid JSON", str(ctx.exception))

    def test_non_object_json_raises_a_clear_error(self):
        with self.assertRaises(ValueError) as ctx:
            GtfsRealtime(
                {"feed_url": "wss://feed.example.org/ws/vehicle_positions/{routes}", "route_labels": "[1, 2]"}
            )
        self.assertIn("route_labels must be a JSON object", str(ctx.exception))
