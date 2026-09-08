import json
from unittest import TestCase

from tests.query_runner.gtfs_static_fixtures import (
    STOPS,
    TRIPS,
    build_archive,
    column_types,
    run_query,
)

ZONE_A = {
    "type": "Feature",
    "id": "zone_a",
    "properties": {"stop_name": "Zone A", "stop_desc": "North side", "service_hours": "6-22"},
    "geometry": {"type": "Polygon", "coordinates": [[[-74.1, 45.3], [-74.0, 45.3], [-74.0, 45.4], [-74.1, 45.3]]]},
}
ZONE_B = {
    "type": "Feature",
    "id": "zone_b",
    "properties": {"stop_name": "Zone B"},
    "geometry": {
        "type": "MultiPolygon",
        "coordinates": [[[[-73.9, 45.5], [-73.8, 45.5], [-73.8, 45.6], [-73.9, 45.5]]]],
    },
}
LOCATIONS = json.dumps({"type": "FeatureCollection", "features": [ZONE_A, ZONE_B]})

BOOKING_RULES = "booking_rule_id,booking_type,prior_notice_duration_min,message\nbr1,1,30,Call ahead\n"
LOCATION_GROUPS = "location_group_id,location_group_name\nlg1,Downtown\n"
LOCATION_GROUP_STOPS = "location_group_id,stop_id\nlg1,S1\nlg1,S2\n"
FLEX_STOP_TIMES = (
    "trip_id,stop_id,location_id,stop_sequence,start_pickup_drop_off_window,end_pickup_drop_off_window,"
    "pickup_booking_rule_id\n"
    "t1,,zone_a,1,08:00:00,18:00:00,br1\n"
    "t1,S2,,2,,,\n"
)

FLEX_MEMBERS = {
    "stops.txt": STOPS,
    "trips.txt": TRIPS,
    "stop_times.txt": FLEX_STOP_TIMES,
    "booking_rules.txt": BOOKING_RULES,
    "location_groups.txt": LOCATION_GROUPS,
    "location_group_stops.txt": LOCATION_GROUP_STOPS,
    "locations.geojson": LOCATIONS,
}

LEVELS = "level_id,level_index,level_name\nL0,0,Street\nL-1,-1,Mezzanine\n"
PATHWAYS = (
    "pathway_id,from_stop_id,to_stop_id,pathway_mode,is_bidirectional,length,traversal_time,stair_count,"
    "max_slope,min_width,signposted_as\n"
    "p1,S1,S2,2,1,12.5,20,18,,1.2,To platforms\n"
    "p2,S2,S1,5,0,,45,,0.08,,\n"
)
PATHWAY_MEMBERS = {"stops.txt": STOPS, "levels.txt": LEVELS, "pathways.txt": PATHWAYS}


class TestFlexLocations(TestCase):
    def test_list_names_locations_with_its_feature_count(self):
        data, error, _get = run_query('{"resource": "list"}', body=build_archive(FLEX_MEMBERS))
        self.assertIsNone(error)
        by_table = {row["table"]: row for row in data["rows"]}
        self.assertIn("booking_rules", by_table)
        self.assertEqual(by_table["locations"]["row_count"], 2)
        self.assertEqual(json.loads(by_table["locations"]["columns"])[:2], ["location_id", "stop_name"])

    def test_locations_rows_carry_id_properties_and_geometry(self):
        data, error, _get = run_query('{"table": "locations"}', body=build_archive(FLEX_MEMBERS))
        self.assertIsNone(error)
        rows = data["rows"]
        self.assertEqual([row["location_id"] for row in rows], ["zone_a", "zone_b"])
        self.assertEqual(rows[0]["stop_name"], "Zone A")
        self.assertEqual(rows[0]["stop_desc"], "North side")
        self.assertEqual(rows[1]["stop_desc"], None)
        self.assertEqual(rows[0]["geometry_type"], "Polygon")
        self.assertEqual(json.loads(rows[0]["geometry"]), ZONE_A["geometry"])
        self.assertEqual(json.loads(rows[0]["properties"]), {"service_hours": "6-22"})
        self.assertEqual(rows[1]["properties"], "")
        self.assertEqual(json.loads(rows[0]["bbox"]), [-74.1, 45.3, -74.0, 45.4])
        self.assertEqual(column_types(data)["location_id"], "string")

    def test_locations_filter_matches_on_properties_and_id(self):
        body = build_archive(FLEX_MEMBERS)
        data, error, _get = run_query('{"table": "locations", "filter": {"stop_name": "Zone B"}}', body=body)
        self.assertIsNone(error)
        self.assertEqual([row["location_id"] for row in data["rows"]], ["zone_b"])

        data, error, _get = run_query('{"table": "locations", "filter": {"location_id": ["zone_a"]}}', body=body)
        self.assertIsNone(error)
        self.assertEqual([row["location_id"] for row in data["rows"]], ["zone_a"])

    def test_locations_featurecollection_is_one_geojson_cell(self):
        query = '{"table": "locations", "format": "featurecollection", "filter": {"stop_name": "Zone A"}}'
        data, error, _get = run_query(query, body=build_archive(FLEX_MEMBERS))
        self.assertIsNone(error)
        self.assertEqual([column["name"] for column in data["columns"]], ["geojson"])
        collection = json.loads(data["rows"][0]["geojson"])
        self.assertEqual(collection["type"], "FeatureCollection")
        self.assertEqual([feature["id"] for feature in collection["features"]], ["zone_a"])
        self.assertEqual(collection["features"][0]["geometry"], ZONE_A["geometry"])

    def test_locations_columns_projection_applies(self):
        query = '{"table": "locations", "columns": ["location_id", "bbox"]}'
        data, error, _get = run_query(query, body=build_archive(FLEX_MEMBERS))
        self.assertIsNone(error)
        self.assertEqual([column["name"] for column in data["columns"]], ["location_id", "bbox"])

    def test_an_unknown_locations_column_is_rejected(self):
        query = '{"table": "locations", "columns": ["zone_id"]}'
        data, error, _get = run_query(query, body=build_archive(FLEX_MEMBERS))
        self.assertIsNone(data)
        self.assertIn("Unknown column 'zone_id'", error)

    def test_locations_rows_are_capped_by_max_rows(self):
        body = build_archive(FLEX_MEMBERS)
        data, error, _get = run_query('{"table": "locations"}', body=body, config={"max_rows": 1})
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 1)
        self.assertTrue(data["truncated"])

    def test_a_locations_member_that_is_not_geojson_is_a_query_error(self):
        members = dict(FLEX_MEMBERS, **{"locations.geojson": "{not json"})
        data, error, _get = run_query('{"table": "locations"}', body=build_archive(members))
        self.assertIsNone(data)
        self.assertIn("locations.geojson", error)

    def test_a_locations_member_without_features_is_a_query_error(self):
        members = dict(FLEX_MEMBERS, **{"locations.geojson": '{"type": "Point", "coordinates": [0, 0]}'})
        data, error, _get = run_query('{"table": "locations"}', body=build_archive(members))
        self.assertIsNone(data)
        self.assertIn("FeatureCollection", error)

    def test_an_archive_without_locations_does_not_know_the_table(self):
        data, error, _get = run_query('{"table": "locations"}')
        self.assertIsNone(data)
        self.assertIn("Unknown table 'locations'", error)

    def test_a_nested_locations_member_is_found_and_apple_double_copies_are_skipped(self):
        members = {
            "feed/stops.txt": STOPS,
            "feed/locations.geojson": LOCATIONS,
            "__MACOSX/feed/._locations.geojson": "x",
        }
        data, error, _get = run_query('{"table": "locations"}', body=build_archive(members))
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 2)

    def test_flex_tables_and_windowed_stop_times_serve_as_ordinary_tables(self):
        body = build_archive(FLEX_MEMBERS)
        data, error, _get = run_query('{"table": "stop_times"}', body=body)
        self.assertIsNone(error)
        rows = data["rows"]
        self.assertEqual(rows[0]["stop_id"], None)
        self.assertEqual(rows[0]["location_id"], "zone_a")
        self.assertEqual(rows[0]["start_pickup_drop_off_window"], "08:00:00")
        self.assertEqual(rows[1]["stop_id"], "S2")
        self.assertEqual(column_types(data)["start_pickup_drop_off_window"], "string")

        data, error, _get = run_query('{"table": "booking_rules"}', body=body)
        self.assertIsNone(error)
        self.assertEqual(data["rows"][0]["prior_notice_duration_min"], 30)
        self.assertEqual(column_types(data)["booking_rule_id"], "string")


class TestPathways(TestCase):
    def test_pathways_and_levels_serve_with_gtfs_types(self):
        body = build_archive(PATHWAY_MEMBERS)
        data, error, _get = run_query('{"table": "pathways"}', body=body)
        self.assertIsNone(error)
        types = column_types(data)
        self.assertEqual(types["pathway_id"], "string")
        self.assertEqual(types["from_stop_id"], "string")
        self.assertEqual(types["stair_count"], "integer")
        self.assertEqual(types["length"], "float")
        self.assertEqual(types["is_bidirectional"], "integer")
        self.assertEqual(types["max_slope"], "float")
        rows = data["rows"]
        self.assertEqual(rows[0]["stair_count"], 18)
        self.assertEqual(rows[1]["stair_count"], None)
        self.assertEqual(rows[1]["max_slope"], 0.08)

        data, error, _get = run_query('{"table": "levels"}', body=body)
        self.assertIsNone(error)
        self.assertEqual([row["level_index"] for row in data["rows"]], [0, -1])
        self.assertEqual(column_types(data)["level_id"], "string")

    def test_pathways_filter_by_mode(self):
        query = '{"table": "pathways", "filter": {"pathway_mode": "5"}}'
        data, error, _get = run_query(query, body=build_archive(PATHWAY_MEMBERS))
        self.assertIsNone(error)
        self.assertEqual([row["pathway_id"] for row in data["rows"]], ["p2"])
