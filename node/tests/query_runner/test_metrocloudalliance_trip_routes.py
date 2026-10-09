import tempfile
from unittest import TestCase
from unittest.mock import patch

from redash.query_runner import metrocloudalliance_public as public
from redash.transit_naming.profile_loader import CORE_PROFILE_DIR, build_profile_set
from tests.query_runner.test_metrocloudalliance_public import (
    ROUTES,
    STOPS,
    responder,
    routes_by_params,
)
from tests.query_runner.test_metrocloudalliance_route_paths import RoutePathsCase
from tests.query_runner.transit_naming_gtfs_fixtures import (
    archive_fetcher,
    build_archive,
)

QUERY = '{"resource": "public_trip_routes", "params": {"carrier_code": "%s"}}'
COLUMNS = ["carrier_code", "trip_id", "route_code", "direction_id", "gtfs_digest"]

PA_URL = "https://gitlab.example.org/pa.zip"
PA_YAML = """carrier_code: PA
carrier_display_name: Pasadena Transit
gtfs_sources:
  - name: pa
    url: https://gitlab.example.org/pa.zip
    join: [short_name]
aliases:
  PA020: {source: pa, gtfs_route_id: 20cc}
extra_trip_routes:
  PA020: [20cw]
"""
PA_ROUTES_TXT = (
    "route_id,route_short_name,route_long_name,route_type,route_color,route_text_color\n"
    "20cc,,Loop clockwise,3,,\n"
    "20cw,,Loop counter,3,,\n"
    "10,10,Ten,3,,\n"
    "30,30,Thirty,3,,\n"
    "31,30,Thirty again,3,,\n"
)
PA_TRIPS_TXT = (
    "route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\n"
    "20cc,WD,c1,,0,\n"
    "20cw,WD,w1,,1,\n"
    "10,WD,t10a,,,\n"
    "30,WD,t30,,0,\n"
    "31,WD,t31,,0,\n"
    "10,WD,shared,,0,\n"
    "30,WD,shared,,0,\n"
)
PA_MEMBERS = {"routes.txt": PA_ROUTES_TXT, "trips.txt": PA_TRIPS_TXT}


def pa_route(code):
    return {"carrier_name": "Pasadena Transit", "carrier_code": "PA", "route_code": code, "route_id": 1}


PA_ROUTE_LIST = [pa_route("PA020"), pa_route("PA010"), pa_route("PA030")]


class TestPublicTripRoutes(RoutePathsCase):
    def rows(self, carrier="MT"):
        return self.run_resource(QUERY % carrier)["rows"]

    def by_route(self, carrier="MT"):
        grouped = {}
        for row in self.rows(carrier):
            grouped.setdefault(row["route_code"], {})[row["trip_id"]] = row["direction_id"]
        return grouped

    def test_columns(self):
        data = self.run_resource(QUERY % "MT")
        self.assertEqual([c["name"] for c in data["columns"]], COLUMNS)

    def test_short_name_join_lists_every_trip_with_its_direction(self):
        self.assertEqual(self.by_route()["MT030"], {"t30a": 0, "t30b": 1})
        self.assertEqual(self.by_route()["MT094"], {"t94a": 0, "t94b": 1})

    def test_route_id_prefix_join_reads_the_rail_archive(self):
        self.assertEqual(self.by_route()["MT801"], {"r801a": 0})

    def test_a_trip_of_a_route_two_codes_share_is_emitted_for_neither(self):
        grouped = self.by_route()
        self.assertNotIn("MT910", grouped)
        self.assertNotIn("MT950", grouped)
        self.assertNotIn("t910a", {row["trip_id"] for row in self.rows()})

    def test_rows_are_unique_per_trip_and_carry_the_digest(self):
        rows = self.rows()
        self.assertEqual(len({r["trip_id"] for r in rows}), len(rows))
        self.assertEqual({r["carrier_code"] for r in rows}, {"MT"})
        self.assertEqual({len(r["gtfs_digest"]) for r in rows}, {64})

    def test_every_trip_of_a_resolved_route_is_listed_without_needing_stop_times(self):
        self.assertEqual(
            set(self.by_route()["MT720"]), {"t720a", "t720b", "t720c", "t720d", "t720e", "t720f", "t720x"}
        )

    def test_carrier_code_is_required(self):
        with patch("redash.query_runner.metrocloudalliance.requests.get") as get:
            _, error = self.runner.run_query('{"resource": "public_trip_routes"}', None)
        self.assertIn("'carrier_code' param is required", error)
        get.assert_not_called()

    def test_an_unknown_carrier_without_routes_yields_typed_empty_columns(self):
        by_url = {ROUTES: lambda params: [], STOPS: lambda params: []}
        with patch("redash.query_runner.metrocloudalliance.requests.get", side_effect=responder(by_url)):
            data, error = self.runner.run_query(QUERY % "ZZ", None)
        self.assertIsNone(error)
        self.assertEqual(data["rows"], [])
        self.assertEqual([c["name"] for c in data["columns"]], COLUMNS)

    def test_an_unknown_carrier_with_routes_has_no_gtfs_so_no_rows(self):
        by_url = {ROUTES: routes_by_params, STOPS: lambda params: []}
        with patch("redash.query_runner.metrocloudalliance.requests.get", side_effect=responder(by_url)):
            data, error = self.runner.run_query(QUERY % "ZZ", None)
        self.assertIsNone(error)
        self.assertEqual(data["rows"], [])
        self.assertEqual([c["name"] for c in data["columns"]], COLUMNS)

    def test_the_resource_is_documented(self):
        schema = self.runner.get_schema()
        names = [entry["name"] for entry in schema]
        self.assertTrue(any("public_trip_routes > returns" in name for name in names))


class TestExtraTripRoutes(TestCase):
    def setUp(self):
        self.cache = tempfile.TemporaryDirectory()
        profiles = build_profile_set([CORE_PROFILE_DIR], extra_files={"/pack/naming_profiles": {"PA.yaml": PA_YAML}})
        fetcher = archive_fetcher({PA_URL: build_archive(PA_MEMBERS)})
        for p in (
            patch.object(public, "load_profile_set", return_value=profiles),
            patch.object(public, "cache_dir", return_value=self.cache.name),
            patch.object(public, "archive_fetch", fetcher),
        ):
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.cache.cleanup)

    def rows(self):
        def fetch(resource, params):
            return PA_ROUTE_LIST

        return public.run_public_resource("public_trip_routes", {"carrier_code": "PA"}, fetch)

    def test_alias_and_extra_route_ids_both_map_to_the_route_code(self):
        found = {r["trip_id"]: (r["route_code"], r["direction_id"]) for r in self.rows()}
        self.assertEqual(found["c1"], ("PA020", 0))
        self.assertEqual(found["w1"], ("PA020", 1))

    def test_a_trip_without_direction_id_has_a_null_direction(self):
        found = {r["trip_id"]: r["direction_id"] for r in self.rows()}
        self.assertIsNone(found["t10a"])

    def test_a_short_name_shared_by_two_gtfs_routes_resolves_to_the_first_only(self):
        found = {r["trip_id"]: r["route_code"] for r in self.rows()}
        self.assertEqual(found["t30"], "PA030")
        self.assertNotIn("t31", found)

    def test_a_trip_id_in_two_routes_of_different_codes_is_emitted_for_neither(self):
        self.assertNotIn("shared", {r["trip_id"] for r in self.rows()})


RS_URL = "https://gitlab.example.org/rs.zip"
RS_YAML = PA_YAML.replace("pa.zip", "rs.zip").replace("extra_trip_routes:\n  PA020: [20cw]\n", "")
RS_MEMBERS = {
    "routes.txt": "route_id,route_short_name,route_long_name,route_type,route_color,route_text_color\n10,10,Ten,3,,\n",
    "trips.txt": "route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\n10,WD,t1,,0,\n",
    "stop_times.txt": (
        "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
        "t1,06:00:00,06:00:00,g1,1\n"
        "t1,06:05:00,06:05:00,g2,2\n"
        "t1,06:10:00,06:10:00,g3,3\n"
    ),
    "stops.txt": (
        "stop_id,stop_code,stop_name,stop_lat,stop_lon\n"
        "g1,g1,Main / First,34.0100,-118.1000\n"
        "g2,g2,Main / Second,34.0200,-118.1000\n"
        "g3,g3,Main / Third,34.0300,-118.1000\n"
    ),
}


def rs_stop(stop_id, lat, lng, modes, predictions):
    return {
        "carrier_code": "PA",
        "stop_id": stop_id,
        "stop_name": f"Stop {stop_id}",
        "lat": lat,
        "lng": lng,
        "on_street": "Main St",
        "cross_street": "Cross St",
        "street_direction": "",
        "transit_modes": modes,
        "prediction_count": predictions,
    }


class TestRouteStopsMatchRetiredStops(TestCase):
    def setUp(self):
        self.cache = tempfile.TemporaryDirectory()
        profiles = build_profile_set([CORE_PROFILE_DIR], extra_files={"/pack/naming_profiles": {"PA.yaml": RS_YAML}})
        fetcher = archive_fetcher({RS_URL: build_archive(RS_MEMBERS)})
        for p in (
            patch.object(public, "load_profile_set", return_value=profiles),
            patch.object(public, "cache_dir", return_value=self.cache.name),
            patch.object(public, "archive_fetch", fetcher),
        ):
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.cache.cleanup)

    def rows(self, stops):
        def fetch(resource, params):
            return [pa_route("PA010")] if resource == "routes" else stops

        rows = public.run_public_resource("public_route_stops", {"carrier_code": "PA"}, fetch)
        return {r["gtfs_stop_id"]: r for r in rows}

    def test_a_carrier_whose_stops_are_all_retired_still_matches_by_id_with_coordinates(self):
        rows = self.rows([rs_stop("g1", 34.0100, -118.1000, "", 0), rs_stop("g2", 34.0200, -118.1000, "", 0)])
        for gtfs_stop_id in ("g1", "g2"):
            self.assertEqual(rows[gtfs_stop_id]["stop_match"], "id")
            self.assertEqual(rows[gtfs_stop_id]["stop_id"], gtfs_stop_id)
            self.assertIsNotNone(rows[gtfs_stop_id]["lat"])
            self.assertIsNotNone(rows[gtfs_stop_id]["lng"])

    def test_a_retired_stop_near_an_unmatched_id_matches_by_coordinate(self):
        rows = self.rows([rs_stop("m9", 34.0300, -118.1000, "", 0)])
        self.assertEqual((rows["g3"]["stop_match"], rows["g3"]["stop_id"]), ("coordinate", "m9"))
        self.assertEqual((rows["g3"]["lat"], rows["g3"]["lng"]), (34.03, -118.1))

    def test_a_carrier_with_live_stops_is_unchanged(self):
        rows = self.rows([rs_stop("g1", 34.0100, -118.1000, "BUS", 3), rs_stop("g2", 34.0200, -118.1000, "BUS", 3)])
        self.assertEqual((rows["g1"]["stop_match"], rows["g1"]["stop_id"]), ("id", "g1"))
        self.assertEqual((rows["g2"]["stop_match"], rows["g2"]["stop_id"]), ("id", "g2"))
        self.assertEqual(rows["g3"]["stop_match"], "unmatched")
        self.assertIsNone(rows["g3"]["lat"])
