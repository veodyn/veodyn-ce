from tests.query_runner.test_metrocloudalliance_public import (
    PATTERNS,
    ROUTES,
    STOPS,
    PublicResourceCase,
)
from tests.query_runner.transit_naming_fixtures import mca_route, mca_stop

BU_ROUTES = [mca_route("BU001", "1", 5, 501, carrier="BU"), mca_route("BU002", "2", 6, 502, carrier="BU")]


def bu_stop(stop_id, name, modes="BUS"):
    return dict(mca_stop(stop_id, name, 34.18, -118.31, modes=modes), carrier_code="BU")


BU_STOPS = [
    bu_stop("10", "OAK AVE/ELM BLVD"),
    bu_stop("11", "Downtown Transit Center"),
    bu_stop("12", "Main St/First St"),
    bu_stop("99", "Quiet Stop", modes=""),
]
MEMBERS = {
    "BU001 N": ["11", "10", "99"],
    "BU001 S": ["12", "11"],
    "BU0011N": ["10"],
}


def pattern(route_code, pattern_code, name):
    return {"carrier_code": "BU", "route_code": route_code, "pattern_code": pattern_code, "pattern_name": name}


def patterns(params):
    return [
        pattern("BU001", "BU001 N", "NORTH SIDE - CIVIC CENTER   "),
        pattern("BU001", "BU001 S", "DOWNTOWN TRANSIT CENTER"),
        pattern("BU001", "BU0011N", "BU001"),
        pattern("BU002", "BU002 E", "EAST SIDE"),
    ]


def routes(params):
    return BU_ROUTES


def stops(params):
    members = MEMBERS.get(params.get("pattern_code"))
    if members is None:
        return BU_STOPS
    return [stop for stop in BU_STOPS if stop["stop_id"] in members]


class TestRouteStopsFromMcaPatterns(PublicResourceCase):
    def rows(self, route="BU001"):
        query = f'{{"resource": "public_route_stops", "params": {{"carrier_code": "BU", "route_code": "{route}"}}}}'
        data, get = self.run_resource(query, {ROUTES: routes, STOPS: stops, PATTERNS: patterns})
        return data["rows"], get

    def test_a_carrier_without_a_gtfs_feed_gets_every_mca_pattern_of_the_route(self):
        rows, _ = self.rows()
        self.assertEqual(sorted({r["pattern_id"] for r in rows}), ["BU001 N", "BU001 S", "BU0011N"])
        self.assertEqual({r["route_code"] for r in rows}, {"BU001"})
        self.assertEqual({r["sequence_source"] for r in rows}, {"mca_pattern"})

    def test_each_pattern_carries_its_recased_name_as_the_headsign(self):
        rows, _ = self.rows()
        headsigns = {r["pattern_id"]: r["headsign"] for r in rows}
        self.assertEqual(headsigns["BU001 N"], "North Side - Civic Center")
        self.assertEqual(headsigns["BU001 S"], "Downtown Transit Center")
        self.assertEqual(headsigns["BU0011N"], "")

    def test_stops_are_the_pattern_members_mca_lists_with_their_public_names(self):
        rows, _ = self.rows()
        north = [r for r in rows if r["pattern_id"] == "BU001 N"]
        self.assertEqual(sorted(r["stop_id"] for r in north), ["10", "11", "99"])
        self.assertIn("Oak Av/Elm Bl", {r["public_name"] for r in north})
        self.assertEqual({r["direction"] for r in north}, {"N"})

    def test_the_pattern_list_is_asked_for_once_per_route(self):
        _, get = self.rows()
        pattern_calls = [c for c in get.call_args_list if c.args[0] == PATTERNS]
        self.assertEqual(len(pattern_calls), 1)
        self.assertEqual(pattern_calls[0].kwargs["params"]["carrier_code"], "BU")
