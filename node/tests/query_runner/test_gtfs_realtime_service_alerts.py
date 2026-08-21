from unittest import TestCase
from unittest.mock import patch

from google.transit import gtfs_realtime_pb2 as pb

from redash.query_runner.gtfs_realtime import GtfsRealtime
from redash.query_runner.gtfs_realtime_entities import build_alert_row
from tests.query_runner.gtfs_realtime_fixtures import (
    build_alert_entity,
    build_feed_message,
    fake_response,
)

ACCIDENT = pb.Alert.ACCIDENT
DETOUR = pb.Alert.DETOUR
WARNING_SEVERITY = pb.Alert.WARNING


class TestBuildAlertRow(TestCase):
    def test_row_shape_with_enums_and_first_translation(self):
        entity = build_alert_entity(
            entity_id="alert-1",
            cause=ACCIDENT,
            effect=DETOUR,
            severity_level=WARNING_SEVERITY,
            header="Bridge closed",
            description="Use the north detour",
            url="https://example.org/alert-1",
            active_periods=[(1752940000, 1752950000)],
            informed_entities=[("10", None), ("20", "s1")],
        )
        row = build_alert_row(entity)
        self.assertEqual(row["alert_id"], "alert-1")
        self.assertEqual(row["cause"], "ACCIDENT")
        self.assertEqual(row["effect"], "DETOUR")
        self.assertEqual(row["severity_level"], "WARNING")
        self.assertEqual(row["header"], "Bridge closed")
        self.assertEqual(row["description"], "Use the north detour")
        self.assertEqual(row["url"], "https://example.org/alert-1")
        self.assertEqual(row["active_from"], "2025-07-19 15:46:40")
        self.assertEqual(row["active_to"], "2025-07-19 18:33:20")
        self.assertEqual(row["informed_route_ids"], "10,20")
        self.assertEqual(row["informed_stop_ids"], "s1")

    def test_enum_defaults_when_cause_and_effect_unset(self):
        entity = build_alert_entity(entity_id="a")
        row = build_alert_row(entity)
        self.assertEqual(row["cause"], "UNKNOWN_CAUSE")
        self.assertEqual(row["effect"], "UNKNOWN_EFFECT")

    def test_severity_level_none_when_unset(self):
        entity = build_alert_entity(entity_id="a")
        row = build_alert_row(entity)
        self.assertIsNone(row["severity_level"])

    def test_first_translation_picked_when_multiple_present(self):
        entity = build_alert_entity(entity_id="a")
        entity.alert.header_text.translation.add(text="First", language="en")
        entity.alert.header_text.translation.add(text="Second", language="fr")
        row = build_alert_row(entity)
        self.assertEqual(row["header"], "First")

    def test_header_description_url_empty_string_when_absent(self):
        entity = build_alert_entity(entity_id="a")
        row = build_alert_row(entity)
        self.assertEqual(row["header"], "")
        self.assertEqual(row["description"], "")
        self.assertEqual(row["url"], "")

    def test_open_ended_active_period_gives_active_to_none(self):
        entity = build_alert_entity(entity_id="a", active_periods=[(1752940000, None)])
        row = build_alert_row(entity)
        self.assertEqual(row["active_from"], "2025-07-19 15:46:40")
        self.assertIsNone(row["active_to"])

    def test_one_open_ended_period_among_several_still_gives_active_to_none(self):
        entity = build_alert_entity(
            entity_id="a",
            active_periods=[(1752940000, 1752950000), (1752941000, None)],
        )
        row = build_alert_row(entity)
        self.assertIsNone(row["active_to"])

    def test_active_from_none_when_no_period_declares_a_start(self):
        entity = build_alert_entity(entity_id="a", active_periods=[(None, 1752950000)])
        row = build_alert_row(entity)
        self.assertIsNone(row["active_from"])

    def test_no_active_periods_gives_both_none(self):
        entity = build_alert_entity(entity_id="a")
        row = build_alert_row(entity)
        self.assertIsNone(row["active_from"])
        self.assertIsNone(row["active_to"])

    def test_active_to_is_the_latest_end_across_multiple_periods(self):
        entity = build_alert_entity(
            entity_id="a",
            active_periods=[(1752940000, 1752945000), (1752941000, 1752950000)],
        )
        row = build_alert_row(entity)
        self.assertEqual(row["active_to"], "2025-07-19 18:33:20")

    def test_active_from_is_the_earliest_start_across_multiple_periods(self):
        entity = build_alert_entity(
            entity_id="a",
            active_periods=[(1752941000, 1752945000), (1752940000, 1752950000)],
        )
        row = build_alert_row(entity)
        self.assertEqual(row["active_from"], "2025-07-19 15:46:40")

    def test_informed_ids_are_sorted_unique_and_comma_joined(self):
        entity = build_alert_entity(
            entity_id="a",
            informed_entities=[("20", "s2"), ("10", "s1"), ("10", "s2"), (None, None)],
        )
        row = build_alert_row(entity)
        self.assertEqual(row["informed_route_ids"], "10,20")
        self.assertEqual(row["informed_stop_ids"], "s1,s2")

    def test_informed_ids_empty_string_when_none(self):
        entity = build_alert_entity(entity_id="a")
        row = build_alert_row(entity)
        self.assertEqual(row["informed_route_ids"], "")
        self.assertEqual(row["informed_stop_ids"], "")

    def test_entity_without_alert_returns_none(self):
        entity = pb.FeedEntity()
        entity.id = "vehicle-only"
        entity.vehicle.position.latitude = 1.0
        entity.vehicle.position.longitude = 2.0
        self.assertIsNone(build_alert_row(entity))


class TestUrlConfiguration(TestCase):
    def test_missing_service_alerts_url_raises_clear_error(self):
        runner = GtfsRealtime({"feed_url": "wss://feed.example.org/ws/vehicle_positions/{routes}"})
        data, error = runner.run_query('{"resource": "service_alerts"}', None)
        self.assertIsNone(data)
        self.assertIn("service_alerts requires the Service alerts URL to be configured on this data source", error)

    def test_whitespace_only_service_alerts_url_raises_clear_error(self):
        runner = GtfsRealtime(
            {
                "feed_url": "wss://feed.example.org/ws/vehicle_positions/{routes}",
                "service_alerts_url": "   ",
            }
        )
        data, error = runner.run_query('{"resource": "service_alerts"}', None)
        self.assertIsNone(data)
        self.assertIn("service_alerts requires the Service alerts URL to be configured on this data source", error)

    def test_websocket_service_alerts_url_raises_clear_error(self):
        runner = GtfsRealtime(
            {
                "feed_url": "wss://feed.example.org/ws/vehicle_positions/{routes}",
                "service_alerts_url": "ws://feed.example.org/ws/alerts/{routes}",
            }
        )
        data, error = runner.run_query('{"resource": "service_alerts"}', None)
        self.assertIsNone(data)
        self.assertIn("service_alerts supports HTTP protobuf feeds only", error)

    def test_ftp_service_alerts_url_raises_clear_error(self):
        runner = GtfsRealtime(
            {
                "feed_url": "wss://feed.example.org/ws/vehicle_positions/{routes}",
                "service_alerts_url": "ftp://feed.example.org/alerts/{routes}",
            }
        )
        with patch("redash.query_runner.gtfs_realtime.requests.get") as get:
            data, error = runner.run_query('{"resource": "service_alerts"}', None)
        self.assertIsNone(data)
        self.assertIn("service_alerts supports HTTP protobuf feeds only", error)
        get.assert_not_called()

    def test_http_service_alerts_url_fetches_and_substitutes_routes(self):
        runner = GtfsRealtime(
            {
                "feed_url": "wss://feed.example.org/ws/vehicle_positions/{routes}",
                "service_alerts_url": "https://feed.example.org/gtfs-rt/alerts/{routes}",
            }
        )
        entity = build_alert_entity(entity_id="a1", cause=ACCIDENT)
        feed = build_feed_message([])
        feed.entity.add().CopyFrom(entity)
        with patch("redash.query_runner.gtfs_realtime.requests.get") as get:
            get.return_value = fake_response(feed.SerializeToString())
            data, error = runner.run_query('{"resource": "service_alerts", "params": {"routes": "1, 2"}}', None)
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 1)
        self.assertEqual(get.call_args.args[0], "https://feed.example.org/gtfs-rt/alerts/1,2")


class TestConfigSchema(TestCase):
    def test_feed_url_required_new_fields_optional(self):
        schema = GtfsRealtime.configuration_schema()
        self.assertIn("feed_url", schema["required"])
        self.assertNotIn("trip_updates_url", schema["required"])
        self.assertNotIn("service_alerts_url", schema["required"])
        self.assertIn("trip_updates_url", schema["properties"])
        self.assertIn("service_alerts_url", schema["properties"])
        self.assertEqual(schema["properties"]["trip_updates_url"]["title"], "Trip updates URL (optional)")
        self.assertEqual(schema["properties"]["service_alerts_url"]["title"], "Service alerts URL (optional)")
