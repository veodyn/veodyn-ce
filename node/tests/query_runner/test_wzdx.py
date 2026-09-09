import json
from unittest import TestCase
from unittest.mock import Mock

import requests

from tests.query_runner.wzdx_fixtures import (
    FEED_INFO,
    FEED_URL,
    LANED,
    SEQUENCED,
    SIMPLE,
    rows_by_id,
    run,
)


class TestWZDxFeed(TestCase):
    def test_feed_info_is_one_row_with_the_version_and_source_count(self):
        data, error, _get = run('{"resource": "feed_info"}')
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 1)
        row = data["rows"][0]
        self.assertEqual(row["version"], "4.2")
        self.assertEqual(row["publisher"], "TestDOT")
        self.assertEqual(row["update_frequency"], 60)
        self.assertEqual(row["data_source_count"], 2)
        self.assertNotIn("data_sources", row)

    def test_data_sources_serve_one_row_per_source(self):
        data, error, _get = run('{"resource": "data_sources"}')
        self.assertIsNone(error)
        self.assertEqual([row["data_source_id"] for row in data["rows"]], ["1", "2"])
        self.assertEqual(data["rows"][0]["organization_name"], "Test City 1")

    def test_a_3x_feed_is_refused_by_version(self):
        legacy = {"road_event_feed_info": {"version": "3.1"}, "type": "FeatureCollection", "features": []}
        data, error, _get = run("{}", payloads={FEED_URL: legacy})
        self.assertIsNone(data)
        self.assertIn("WZDx 3.x", error)
        self.assertIn("road_event_feed_info", error)

    def test_a_document_without_feed_info_is_refused(self):
        data, error, _get = run("{}", payloads={FEED_URL: {"type": "FeatureCollection", "features": []}})
        self.assertIsNone(data)
        self.assertIn("feed_info", error)

    def test_a_non_collection_document_is_refused(self):
        data, error, _get = run("{}", payloads={FEED_URL: {"feed_info": FEED_INFO, "type": "Feature"}})
        self.assertIsNone(data)
        self.assertIn("FeatureCollection", error)

    def test_an_http_failure_is_reported_as_a_request_failure(self):
        def get(url, timeout=None, headers=None):
            response = Mock()
            response.raise_for_status.side_effect = requests.HTTPError("503 Server Error")
            return response

        data, error, _get = run("{}", get=get)
        self.assertIsNone(data)
        self.assertIn("request failed", error)
        self.assertIn("503", error)

    def test_an_unknown_resource_is_rejected(self):
        data, error, _get = run('{"resource": "signals"}')
        self.assertIsNone(data)
        self.assertIn("Unknown resource", error)

    def test_requests_carry_the_timeout_and_connector_user_agent(self):
        _data, _error, get = run('{"resource": "feed_info"}')
        _args, kwargs = get.call_args
        self.assertEqual(kwargs["timeout"], 5)
        self.assertIn("Veodyn", kwargs["headers"]["User-Agent"])


class TestRoadEvents(TestCase):
    def test_road_events_is_the_default_and_flattens_core_details(self):
        data, error, _get = run("{}")
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 4)
        row = rows_by_id(data)[SIMPLE["id"]]
        self.assertEqual(row["event_type"], "work-zone")
        self.assertEqual(row["data_source_id"], "1")
        self.assertEqual(json.loads(row["road_names"]), ["I-80", "I-35"])
        self.assertEqual(row["direction"], "northbound")
        self.assertEqual(row["name"], None)
        self.assertEqual(row["start_date"], "2010-01-01T01:00:00Z")
        self.assertEqual(row["vehicle_impact"], "some-lanes-closed")
        self.assertEqual(row["beginning_milepost"], 125.2)
        self.assertEqual(row["reduced_speed_limit_kph"], 88.514)
        self.assertEqual(row["is_start_date_verified"], False)
        self.assertEqual(row["lane_count"], 0)
        self.assertEqual(row["workers_present"], None)
        self.assertEqual(row["geometry_type"], "LineString")
        self.assertEqual(json.loads(row["geometry"]), SIMPLE["geometry"])
        self.assertEqual(json.loads(row["bbox"]), [-93.776688, 41.617961, -93.776682, 41.622297])
        self.assertEqual(row["properties"], "")

    def test_lifted_arrays_and_worker_presence_land_in_their_columns(self):
        data, error, _get = run("{}")
        self.assertIsNone(error)
        row = rows_by_id(data)[SEQUENCED["id"]]
        self.assertEqual(row["workers_present"], True)
        self.assertEqual(row["lane_count"], 3)
        self.assertEqual(json.loads(row["types_of_work"])[0]["type_name"], "surface-work")
        self.assertEqual(json.loads(row["restrictions"]), [])
        self.assertEqual(
            [link["type"] for link in json.loads(row["related_road_events"])],
            ["first-in-sequence", "next-in-sequence"],
        )

    def test_properties_holds_what_was_not_lifted(self):
        data, error, _get = run("{}")
        self.assertIsNone(error)
        remainder = json.loads(rows_by_id(data)[SEQUENCED["id"]]["properties"])
        self.assertEqual(set(remainder), {"worker_presence", "lanes"})
        self.assertEqual(remainder["worker_presence"]["method"], "check-in-app")

    def test_column_types_come_from_the_values(self):
        data, error, _get = run("{}")
        self.assertIsNone(error)
        types = {column["name"]: column["type"] for column in data["columns"]}
        self.assertEqual(types["beginning_milepost"], "float")
        self.assertEqual(types["lane_count"], "integer")
        self.assertEqual(types["id"], "string")

    def test_filter_reaches_core_details_fields(self):
        data, error, _get = run('{"params": {"filter": {"event_type": "detour"}}}')
        self.assertIsNone(error)
        self.assertEqual([row["id"] for row in data["rows"]], ["detour-1"])

        data, error, _get = run('{"params": {"filter": {"direction": ["westbound", "eastbound"]}}}')
        self.assertIsNone(error)
        self.assertEqual([row["id"] for row in data["rows"]], [SEQUENCED["id"], "detour-1"])

    def test_filter_on_an_array_column_matches_any_element(self):
        data, error, _get = run('{"params": {"filter": {"road_names": "I-35"}}}')
        self.assertIsNone(error)
        self.assertEqual([row["id"] for row in data["rows"]], [SIMPLE["id"]])

    def test_filter_on_a_boolean_column_accepts_true_as_text(self):
        data, error, _get = run('{"params": {"filter": {"workers_present": "true"}}}')
        self.assertIsNone(error)
        self.assertEqual([row["id"] for row in data["rows"]], [SEQUENCED["id"]])

        data, error, _get = run('{"params": {"filter": {"is_start_date_verified": false}}}')
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 2)

    def test_filter_on_an_unknown_column_matches_nothing(self):
        data, error, _get = run('{"params": {"filter": {"zone_id": ""}}}')
        self.assertIsNone(error)
        self.assertEqual(data["rows"], [])

    def test_featurecollection_is_one_geojson_cell_of_the_matching_features(self):
        query = '{"params": {"format": "featurecollection", "filter": {"data_source_id": "1"}}}'
        data, error, _get = run(query)
        self.assertIsNone(error)
        self.assertEqual([column["name"] for column in data["columns"]], ["geojson"])
        collection = json.loads(data["rows"][0]["geojson"])
        self.assertEqual(collection["type"], "FeatureCollection")
        self.assertEqual([feature["id"] for feature in collection["features"]], [SIMPLE["id"], LANED["id"]])
        self.assertEqual(collection["features"][1]["properties"]["lanes"], LANED["properties"]["lanes"])

    def test_max_rows_caps_the_rows_and_flags_truncation(self):
        data, error, _get = run("{}", max_rows=2)
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 2)
        self.assertTrue(data["truncated"])

        data, error, _get = run("{}", max_rows=4)
        self.assertIsNone(error)
        self.assertNotIn("truncated", data)

    def test_an_invalid_max_rows_is_a_query_error(self):
        data, error, _get = run("{}", max_rows=0)
        self.assertIsNone(data)
        self.assertIn("max_rows", error.lower().replace(" ", "_"))
