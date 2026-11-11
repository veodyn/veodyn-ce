from redash.query_runner.metrocloudalliance_departures import flatten_departures
from redash.transit_naming.departures import enrich_departures
from tests.query_runner.test_metrocloudalliance_public import (
    PREDICTIONS,
    ROUTES,
    STOPS,
    PublicResourceCase,
    routes_by_params,
    stops_by_params,
)
from tests.query_runner.transit_naming_fixtures import T0, metro_profile


def served(route, pattern_code, direction):
    return {
        "route": route,
        "route_id": route,
        "line_code": f"MT{route.zfill(3)}",
        "pattern_code": pattern_code,
        "direction": direction,
        "sign": "El Monte Station",
        "schedule": {"times_ts": [T0 + 600]},
    }


SHARED_STATION = {
    "carrier_code": "MT",
    "carrier_id": 34,
    "stop_id": "30019",
    "stop_name": "El Monte Station - Lower Level",
    "lat": 34.0763,
    "lng": -118.0423,
    "routes": [
        served("910", "MT910 N", "N"),
        served("910", "MT950 S", "S"),
        served("950", None, "N"),
        served("35", "MT0381N", "N"),
        served("76", "MT076 E", "E"),
        served("707", "MT707 E", "E"),
    ],
}


class TestEveryDepartureNamesItsRoute(PublicResourceCase):
    def rows(self):
        data, _ = self.run_resource(
            '{"resource": "public_departures", "params": {"stop": "MT:30019"}}',
            {PREDICTIONS: [SHARED_STATION], ROUTES: routes_by_params, STOPS: stops_by_params},
        )
        return data["rows"]

    def test_the_pattern_names_the_route_even_under_a_sibling_routes_number(self):
        codes = {(row["raw_route"], row["pattern_code"]): row["route_code"] for row in self.rows()}
        self.assertEqual(codes[("910", "MT910 N")], "MT910")
        self.assertEqual(codes[("910", "MT950 S")], "MT950")
        self.assertEqual(codes[("35", "MT0381N")], "MT038")

    def test_without_a_pattern_the_raw_route_number_names_the_route(self):
        codes = {(row["raw_route"], row["pattern_code"]): row["route_code"] for row in self.rows()}
        self.assertEqual(codes[("950", None)], "MT950")

    def test_a_route_the_carrier_does_not_list_gets_its_code_from_the_number(self):
        codes = {row["raw_route"]: row["route_code"] for row in self.rows()}
        self.assertEqual((codes["76"], codes["707"]), ("MT076", "MT707"))

    def test_route_code_is_a_documented_column(self):
        data, _ = self.run_resource(
            '{"resource": "public_departures", "params": {"stop": "MT:30019"}}',
            {PREDICTIONS: [SHARED_STATION], ROUTES: routes_by_params, STOPS: stops_by_params},
        )
        self.assertIn("route_code", [column["name"] for column in data["columns"]])

    def test_without_a_code_table_the_number_still_gives_the_code(self):
        rows = enrich_departures(flatten_departures([SHARED_STATION]), {}, {}, metro_profile(), "r", "d")
        self.assertEqual({row["raw_route"]: row["route_code"] for row in rows}["910"], "MT910")
