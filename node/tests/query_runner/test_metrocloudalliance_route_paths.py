import json
import tempfile
from unittest import TestCase
from unittest.mock import patch

from redash.query_runner import metrocloudalliance_public as public
from redash.query_runner.metrocloudalliance import MetroCloudAlliance
from tests.query_runner.test_metrocloudalliance_public import (
    ROUTES,
    STOPS,
    responder,
    routes_by_params,
    stops_by_params,
)
from tests.query_runner.transit_naming_fixtures import metro_profiles
from tests.query_runner.transit_naming_shapes_fixtures import shape_archives

PATHS_QUERY = '{"resource": "public_route_paths", "params": {"carrier_code": "MT"}}'
STOPS_QUERY = '{"resource": "public_route_stops", "params": {"carrier_code": "MT"}}'
COLUMNS = [
    "carrier_code",
    "route_code",
    "pattern_id",
    "is_canonical",
    "direction_id",
    "direction",
    "headsign",
    "shape_id",
    "trip_count",
    "point_count",
    "geometry",
    "gtfs_digest",
]


class RoutePathsCase(TestCase):
    def setUp(self):
        self.cache = tempfile.TemporaryDirectory()
        patches = [
            patch.object(public, "load_profile_set", return_value=metro_profiles()),
            patch.object(public, "cache_dir", return_value=self.cache.name),
            patch.object(public, "archive_fetch", shape_archives()),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.cache.cleanup)
        self.runner = MetroCloudAlliance({"api_key": "demo"})

    def run_resource(self, query):
        by_url = {ROUTES: routes_by_params, STOPS: stops_by_params}
        with patch("redash.query_runner.metrocloudalliance.requests.get", side_effect=responder(by_url)):
            data, error = self.runner.run_query(query, None)
        self.assertIsNone(error, error)
        return data

    def paths(self):
        rows = self.run_resource(PATHS_QUERY)["rows"]
        return {(r["route_code"], r["pattern_id"]): r for r in rows}


class TestPublicRoutePaths(RoutePathsCase):
    def test_columns_and_one_row_per_pattern(self):
        data = self.run_resource(PATHS_QUERY)
        self.assertEqual([c["name"] for c in data["columns"]], COLUMNS)
        rows = {(r["route_code"], r["pattern_id"]) for r in data["rows"]}
        self.assertEqual(
            {k for k in rows if k[0] == "MT720"},
            {("MT720", "720_0"), ("MT720", "720_0-2"), ("MT720", "720_1a"), ("MT720", "720_1a-2")},
        )
        self.assertEqual(len(rows), len(data["rows"]))

    def test_pattern_ids_match_public_route_stops(self):
        paths = self.run_resource(PATHS_QUERY)["rows"]
        stops = self.run_resource(STOPS_QUERY)["rows"]

        def key(row):
            return (row["route_code"], row["direction"], row["pattern_id"], row["is_canonical"])

        self.assertEqual({key(r) for r in paths}, {key(r) for r in stops if r["sequence_source"] == "gtfs_stop_times"})

    def test_representative_shape_is_the_most_common_over_the_trips_not_the_pattern_label(self):
        paths = self.paths()
        self.assertEqual(paths[("MT720", "720_0")]["shape_id"], "720_0b")
        self.assertEqual(paths[("MT720", "720_0")]["trip_count"], 3)
        self.assertEqual(paths[("MT720", "720_0-2")]["shape_id"], "720_0-2")

    def test_ties_go_to_the_smallest_shape_even_when_the_larger_comes_first(self):
        paths = self.paths()
        tied = paths[("MT720", "720_1a")]
        self.assertEqual(tied["shape_id"], "720_1")
        self.assertEqual(json.loads(tied["geometry"])["coordinates"], [[-118.0, 34.5], [-118.1, 34.6]])
        self.assertEqual(paths[("MT720", "720_1a-2")]["shape_id"], "720_1a")

    def test_headsign_is_most_common_non_empty_ties_smallest_else_empty(self):
        paths = self.paths()
        self.assertEqual(paths[("MT720", "720_0")]["headsign"], "Santa Monica")
        self.assertEqual(paths[("MT720", "720_0-2")]["headsign"], "")
        self.assertEqual(paths[("MT720", "720_1a")]["headsign"], "Alpha")

    def test_points_follow_numeric_sequence_and_are_simplified_without_going_under_two(self):
        paths = self.paths()
        unordered = paths[("MT030", "30_0")]
        self.assertEqual(
            json.loads(unordered["geometry"]),
            {"type": "LineString", "coordinates": [[-118.0, 34.0], [-117.9, 34.01], [-117.8, 34.0]]},
        )
        self.assertEqual(unordered["point_count"], 3)
        collinear = paths[("MT720", "720_0")]
        self.assertEqual(json.loads(collinear["geometry"])["coordinates"], [[-118.0, 34.0], [-117.7, 34.0]])
        self.assertEqual(collinear["point_count"], 2)

    def test_geometry_is_null_without_a_usable_shape(self):
        paths = self.paths()
        single_point = paths[("MT030", "30_1")]
        self.assertEqual(
            (single_point["shape_id"], single_point["geometry"], single_point["point_count"]), ("30_1", None, 0)
        )
        no_shape_id = paths[("MT094", "Central Station")]
        self.assertEqual((no_shape_id["shape_id"], no_shape_id["geometry"]), (None, None))
        missing_shape = paths[("MT950", "910_0")]
        self.assertEqual((missing_shape["shape_id"], missing_shape["geometry"]), ("910_0", None))

    def test_direction_columns_and_digest(self):
        paths = self.paths()
        row = paths[("MT030", "30_0")]
        self.assertEqual((row["direction"], row["direction_id"], row["is_canonical"]), ("E", 0, True))
        self.assertEqual(paths[("MT094", "Central Station")]["direction"], "S")
        self.assertEqual(len(row["gtfs_digest"]), 64)

    def test_carrier_code_is_required(self):
        with patch("redash.query_runner.metrocloudalliance.requests.get") as get:
            data, error = self.runner.run_query('{"resource": "public_route_paths"}', None)
        self.assertIn("'carrier_code' param is required", error)
        get.assert_not_called()


class TestPublicRouteStopsAdditions(RoutePathsCase):
    def test_rows_carry_direction_id_and_coordinates_from_stops_txt(self):
        rows = self.run_resource(STOPS_QUERY)["rows"]
        row = next(r for r in rows if r["route_code"] == "MT030" and r["gtfs_stop_id"] == "13574")
        self.assertEqual((row["direction_id"], row["lat"], row["lng"]), (0, 34.04, -118.26))
        unmatched = next(r for r in rows if r["gtfs_stop_id"] == "9999")
        self.assertEqual((unmatched["direction_id"], unmatched["lat"], unmatched["lng"]), (1, None, None))

    def test_unmatched_stops_have_null_coordinates_even_when_stops_txt_has_them(self):
        rows = self.run_resource(STOPS_QUERY)["rows"]
        row = next(r for r in rows if r["gtfs_stop_id"] == "9002")
        self.assertEqual((row["stop_match"], row["lat"], row["lng"]), ("unmatched", None, None))

    def test_canonical_only_drops_the_other_patterns(self):
        query = '{"resource": "public_route_stops", "params": {"carrier_code": "MT", "canonical_only": true}}'
        rows = self.run_resource(query)["rows"]
        self.assertTrue(rows)
        self.assertEqual({r["is_canonical"] for r in rows}, {True})
        everything = self.run_resource(STOPS_QUERY)["rows"]
        self.assertGreater(len(everything), len(rows))
