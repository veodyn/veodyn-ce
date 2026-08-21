import json
from unittest import TestCase
from unittest.mock import MagicMock, patch

import requests

from redash.query_runner.gtfs_realtime import GtfsRealtime
from redash.query_runner.gtfs_realtime_entities import parse_vehicle_entity
from redash.query_runner.gtfs_realtime_transport import MAX_FEED_BYTES
from tests.query_runner.gtfs_realtime_fixtures import (
    ROUTE_LABELS,
    build_feed_message,
    build_vehicle_entity,
    fake_response,
    fake_ws,
)


class TestParseVehicleEntity(TestCase):
    def test_normalization(self):
        entity = build_vehicle_entity(
            entity_id="9000-1",
            vehicle_id="9000-1",
            latitude=10.0,
            longitude=20.0,
            bearing=45.0,
            speed=10.0,
            route_id="42",
            direction_id=1,
            timestamp=1752940000,
        )
        row = parse_vehicle_entity(entity, {"42": "Green Line"})
        self.assertEqual(row["vehicle_id"], "9000-1")
        self.assertEqual(row["route_id"], "42")
        self.assertEqual(row["line"], "Green Line")
        self.assertEqual(row["latitude"], 10.0)
        self.assertEqual(row["longitude"], 20.0)
        self.assertEqual(row["bearing"], 45.0)
        self.assertEqual(row["speed"], 10.0)
        self.assertEqual(row["direction_id"], 1)
        self.assertTrue(row["timestamp"].startswith("2025-") or row["timestamp"].startswith("2026-"))
        self.assertEqual(row["_ts"], 1752940000)

    def test_missing_position_returns_none(self):
        entity = build_vehicle_entity(entity_id="x", with_position=False)
        self.assertIsNone(parse_vehicle_entity(entity, {}))

    def test_optional_fields_absent_map_to_none(self):
        entity = build_vehicle_entity(entity_id="9000-1", vehicle_id="9000-1", latitude=1.0, longitude=2.0)
        row = parse_vehicle_entity(entity, {})
        self.assertIsNone(row["bearing"])
        self.assertIsNone(row["speed"])
        self.assertIsNone(row["direction_id"])
        self.assertIsNone(row["timestamp"])
        self.assertEqual(row["_ts"], 0)

    def test_explicit_timestamp_of_zero_is_not_treated_as_absent(self):
        entity = build_vehicle_entity(entity_id="x", vehicle_id="x", latitude=1.0, longitude=2.0, timestamp=0)
        row = parse_vehicle_entity(entity, {})
        self.assertEqual(row["timestamp"], "1970-01-01 00:00:00")
        self.assertEqual(row["_ts"], 0)

    def test_vehicle_id_falls_back_to_entity_id(self):
        entity = build_vehicle_entity(entity_id="e-42", latitude=1.0, longitude=2.0)
        row = parse_vehicle_entity(entity, {})
        self.assertEqual(row["vehicle_id"], "e-42")

    def test_vehicle_id_falls_back_when_descriptor_id_is_empty_string(self):
        entity = build_vehicle_entity(entity_id="e-42", vehicle_id="", latitude=1.0, longitude=2.0)
        row = parse_vehicle_entity(entity, {})
        self.assertEqual(row["vehicle_id"], "e-42")

    def test_skips_when_neither_vehicle_id_nor_entity_id(self):
        entity = build_vehicle_entity(entity_id="", latitude=1.0, longitude=2.0)
        self.assertIsNone(parse_vehicle_entity(entity, {}))

    def test_unknown_route_kept_verbatim(self):
        entity = build_vehicle_entity(entity_id="e-1", route_id="99", latitude=1.0, longitude=2.0)
        row = parse_vehicle_entity(entity, {})
        self.assertEqual(row["line"], "99")


class TestSchemeRouting(TestCase):
    def test_ws_scheme_still_uses_websocket_path(self):
        runner = GtfsRealtime(
            {"feed_url": "wss://feed.example.org/ws/vehicle_positions/{routes}", "sample_seconds": 5}
        )
        with patch("redash.query_runner.gtfs_realtime.ws_connect", return_value=fake_ws([])) as connect:
            data, error = runner.run_query('{"resource": "vehicle_positions"}', None)
        self.assertIsNone(error)
        connect.assert_called_once()

    def test_plain_ws_scheme_also_uses_websocket_path(self):
        runner = GtfsRealtime({"feed_url": "ws://feed.example.org/ws/vehicle_positions/{routes}"})
        with patch("redash.query_runner.gtfs_realtime.ws_connect", return_value=fake_ws([])) as connect:
            data, error = runner.run_query('{"resource": "vehicle_positions"}', None)
        self.assertIsNone(error)
        connect.assert_called_once()

    def test_plain_http_scheme_uses_the_http_path(self):
        runner = GtfsRealtime({"feed_url": "http://feed.example.org/vehicle_positions/{routes}"})
        entity = build_vehicle_entity(entity_id="x", vehicle_id="x", latitude=1.0, longitude=2.0)
        feed = build_feed_message([entity])
        with patch("redash.query_runner.gtfs_realtime.requests.get") as get:
            get.return_value = fake_response(feed.SerializeToString())
            data, error = runner.run_query('{"resource": "vehicle_positions"}', None)
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 1)
        self.assertEqual(get.call_args.args[0], "http://feed.example.org/vehicle_positions/")

    def test_unknown_scheme_raises_a_clear_error_and_touches_no_transport(self):
        runner = GtfsRealtime({"feed_url": "ftp://feed.example.org/vehicle_positions/{routes}"})
        with patch("redash.query_runner.gtfs_realtime.ws_connect") as ws_connect_mock:
            with patch("redash.query_runner.gtfs_realtime.requests.get") as get_mock:
                data, error = runner.run_query('{"resource": "vehicle_positions"}', None)
        self.assertIsNone(data)
        self.assertIn("unsupported GTFS-Realtime feed URL scheme: 'ftp'", error)
        ws_connect_mock.assert_not_called()
        get_mock.assert_not_called()


class TestHttpFetch(TestCase):
    def setUp(self):
        self.runner = GtfsRealtime(
            {
                "feed_url": "https://feed.example.org/gtfs-rt/vehicle_positions/{routes}",
                "route_labels": json.dumps(ROUTE_LABELS),
            }
        )

    def test_parses_feed_message_and_dedupes_by_vehicle_keeping_newest(self):
        older = build_vehicle_entity(
            entity_id="1150-1161",
            vehicle_id="1150-1161",
            latitude=10.0,
            longitude=20.0,
            route_id="10",
            timestamp=1752940000,
        )
        newer = build_vehicle_entity(
            entity_id="1150-1161",
            vehicle_id="1150-1161",
            latitude=10.5,
            longitude=20.5,
            route_id="10",
            timestamp=1752940060,
        )
        other = build_vehicle_entity(
            entity_id="2200-1",
            vehicle_id="2200-1",
            latitude=9.0,
            longitude=19.0,
            route_id="20",
            timestamp=1752940030,
        )
        # newer sorts first in the feed: only a genuine timestamp comparison,
        # not feed order, can make the dedupe keep it over the later "older".
        feed = build_feed_message([newer, other, older])

        with patch("redash.query_runner.gtfs_realtime.requests.get") as get:
            get.return_value = fake_response(feed.SerializeToString())
            data, error = self.runner.run_query(
                '{"resource": "vehicle_positions", "params": {"routes": "10,20"}}', None
            )

        self.assertIsNone(error)
        rows = data["rows"]
        self.assertEqual(len(rows), 2)
        by_id = {row["vehicle_id"]: row for row in rows}
        self.assertEqual(by_id["1150-1161"]["latitude"], 10.5)  # newer update won
        self.assertEqual(by_id["2200-1"]["line"], "Green Line")
        self.assertNotIn("_ts", rows[0])

        url = get.call_args.args[0]
        self.assertEqual(url, "https://feed.example.org/gtfs-rt/vehicle_positions/10,20")
        self.assertEqual(get.call_args.kwargs.get("timeout"), 10)

    def test_bad_body_error_sanitizes_the_url(self):
        runner = GtfsRealtime(
            {"feed_url": "https://feed.example.org/gtfs-rt/vehicle_positions/{routes}?token=SECRET123#frag"}
        )
        with patch("redash.query_runner.gtfs_realtime.requests.get") as get:
            get.return_value = fake_response(b"this is not a protobuf feed message")
            data, error = runner.run_query('{"resource": "vehicle_positions"}', None)

        self.assertIsNone(data)
        self.assertIn("https://feed.example.org/gtfs-rt/vehicle_positions/", error)
        self.assertNotIn("token", error)
        self.assertNotIn("SECRET123", error)
        self.assertNotIn("frag", error)

    def test_http_error_status_sanitizes_the_url(self):
        runner = GtfsRealtime(
            {"feed_url": "https://feed.example.org/gtfs-rt/vehicle_positions/{routes}?token=SECRET123"}
        )
        http_error = requests.HTTPError("404 Client Error: Not Found for url: .../?token=SECRET123")
        http_error.response = MagicMock(status_code=404)
        with patch("redash.query_runner.gtfs_realtime.requests.get") as get:
            get.return_value = fake_response(b"", raise_error=http_error)
            data, error = runner.run_query('{"resource": "vehicle_positions"}', None)

        self.assertIsNone(data)
        self.assertIn("404", error)
        self.assertNotIn("token", error)
        self.assertNotIn("SECRET123", error)

    def test_empty_body_is_rejected_rather_than_treated_as_an_empty_feed(self):
        with patch("redash.query_runner.gtfs_realtime.requests.get") as get:
            get.return_value = fake_response(b"")
            data, error = self.runner.run_query('{"resource": "vehicle_positions"}', None)

        self.assertIsNone(data)
        self.assertIn("missing required fields", error.lower())

    def test_decodable_but_uninitialized_message_is_rejected(self):
        entity = build_vehicle_entity(entity_id="x", vehicle_id="x", latitude=1.0, longitude=2.0)
        feed = build_feed_message([entity], version=None)  # omits the required header field

        with patch("redash.query_runner.gtfs_realtime.requests.get") as get:
            get.return_value = fake_response(feed.SerializePartialToString())
            data, error = self.runner.run_query('{"resource": "vehicle_positions"}', None)

        self.assertIsNone(data)
        self.assertIn("missing required fields", error.lower())

    def test_body_over_the_size_cap_is_rejected(self):
        oversized = b"x" * (MAX_FEED_BYTES + 1)
        with patch("redash.query_runner.gtfs_realtime.requests.get") as get:
            get.return_value = fake_response(oversized)
            data, error = self.runner.run_query('{"resource": "vehicle_positions"}', None)

        self.assertIsNone(data)
        self.assertIn(str(MAX_FEED_BYTES), error)

    def test_sample_seconds_is_ignored_for_http(self):
        entity = build_vehicle_entity(entity_id="x", vehicle_id="x", latitude=1.0, longitude=2.0)
        feed = build_feed_message([entity])
        with patch("redash.query_runner.gtfs_realtime.requests.get") as get:
            get.return_value = fake_response(feed.SerializeToString())
            data, error = self.runner.run_query(
                '{"resource": "vehicle_positions", "params": {"sample_seconds": 30}}', None
            )
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 1)


class TestPbDependencyMissing(TestCase):
    def test_http_fetch_without_bindings_raises_a_clear_error(self):
        runner = GtfsRealtime({"feed_url": "https://feed.example.org/vehicle_positions/{routes}"})
        with patch("redash.query_runner.gtfs_realtime.pb_available", False):
            data, error = runner.run_query('{"resource": "vehicle_positions"}', None)
        self.assertIsNone(data)
        self.assertIn("gtfs-realtime-bindings", error)


class TestEnabled(TestCase):
    def test_enabled_true_if_either_dependency_present(self):
        with patch("redash.query_runner.gtfs_realtime.ws_available", True):
            with patch("redash.query_runner.gtfs_realtime.pb_available", False):
                self.assertTrue(GtfsRealtime.enabled())
        with patch("redash.query_runner.gtfs_realtime.ws_available", False):
            with patch("redash.query_runner.gtfs_realtime.pb_available", True):
                self.assertTrue(GtfsRealtime.enabled())

    def test_enabled_false_if_neither_dependency_present(self):
        with patch("redash.query_runner.gtfs_realtime.ws_available", False):
            with patch("redash.query_runner.gtfs_realtime.pb_available", False):
                self.assertFalse(GtfsRealtime.enabled())


class TestConfigSchemaCoversBothModes(TestCase):
    def test_feed_url_description_covers_http_and_websocket(self):
        schema = GtfsRealtime.configuration_schema()
        description = schema["properties"]["feed_url"]["description"].lower()
        self.assertIn("http", description)
        self.assertIn("ws", description)

    def test_sample_seconds_doc_param_notes_websocket_only(self):
        doc_params = GtfsRealtime.resources["vehicle_positions"]["doc_params"]
        sample_doc = next(p for p in doc_params if p.startswith("sample_seconds"))
        self.assertIn("websocket", sample_doc.lower())
