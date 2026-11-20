import os
import tempfile
from unittest import TestCase
from unittest.mock import patch

from redash.query_runner import metrocloudalliance_public as public
from redash.transit_naming import terminals
from redash.transit_naming.gtfs_routes import read_snapshot
from redash.transit_naming.terminals import TerminalIndexes, terminal_index
from tests.query_runner.test_metrocloudalliance_public import (
    PREDICTIONS,
    ROUTES,
    STOPS,
    PublicResourceCase,
    routes_by_params,
)
from tests.query_runner.transit_naming_fixtures import T0, metro_profile
from tests.query_runner.transit_naming_gtfs_fixtures import (
    BUS_URL,
    RAIL_MEMBERS,
    RAIL_URL,
    archive_fetcher,
    build_archive,
)

TERMINAL_BUS = {
    "routes.txt": (
        "route_id,route_short_name,route_long_name,route_desc,route_type,route_color,route_text_color\n"
        "30-13201,30,Metro Local Line,ALDER - BIRCH,3,,\n"
        "94-13201,94,Metro Local Line,LOOP,3,,\n"
    ),
    "trips.txt": (
        "route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\n"
        "30-13201,WD,out,,0,1,s0\n"
        "30-13201,WD,back,,1,1,s1\n"
        "94-13201,WD,loop,,0,2,s2\n"
    ),
    "stop_times.txt": (
        "trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n"
        "out,06:00:00,06:00:00,501,1,0,0\n"
        "out,06:05:00,06:05:00,502,2,0,0\n"
        "out,06:10:00,06:10:00,503,3,0,0\n"
        "out,06:15:00,06:15:00,600,4,0,0\n"
        "back,07:00:00,07:00:00,600,1,0,0\n"
        "back,07:05:00,07:05:00,513,2,0,0\n"
        "back,07:10:00,07:10:00,512,3,0,0\n"
        "back,07:15:00,07:15:00,511,4,0,0\n"
        "back,07:20:00,07:20:00,599,5,1,1\n"
        "loop,08:00:00,08:00:00,700,1,0,0\n"
        "loop,08:05:00,08:05:00,701,2,0,0\n"
        "loop,08:10:00,08:10:00,700,3,0,0\n"
    ),
    "stops.txt": (
        "stop_id,stop_code,stop_name,stop_lat,stop_lon\n"
        + "".join(f"{i},{i},Alder Way / Stop {i},34.0{i},-118.2{i}\n" for i in (501, 502, 503, 511, 512, 513, 599))
        + "600,600,Birch Transit Hub,34.0600,-118.2600\n"
        + "700,700,Cedar Loop Plaza,34.0700,-118.2700\n"
        + "701,701,Cedar Loop / North,34.0701,-118.2701\n"
    ),
}
MEMBERS = {
    "MT030 E": ["501", "502", "503", "600"],
    "MT030 W": ["600", "513", "512", "511"],
    "MT030 X": ["600", "503", "513"],
    "MT094 N": ["700", "701"],
}


def scheduled(route, pattern_code, direction, minutes=10):
    return {
        "route": route,
        "route_id": route,
        "pattern_code": pattern_code,
        "direction": direction,
        "sign": "Birch Transit Hub",
        "schedule": {"times_ts": [T0 + minutes * 60]},
    }


def station(stop_id, routes):
    return {"carrier_code": "MT", "carrier_id": 34, "stop_id": stop_id, "stop_name": "Hub", "routes": routes}


HUB = station(
    "600",
    [
        scheduled("30", "MT030 E", "E", 5),
        scheduled("30", "MT030 W", "W", 6),
        scheduled("30", "MT030 X", "E", 7),
        scheduled("30", None, "E", 8),
    ],
)


def stops(params):
    if params.get("pattern_code"):
        return [{"stop_id": stop_id} for stop_id in MEMBERS.get(params["pattern_code"], [])]
    return []


def terminal_archives(bus=None):
    return archive_fetcher({BUS_URL: bus or build_archive(TERMINAL_BUS), RAIL_URL: build_archive(RAIL_MEMBERS)})


class TestTerminalIndex(TestCase):
    def setUp(self):
        self.index = terminal_index(read_snapshot("bus", build_archive(TERMINAL_BUS), "u", with_patterns=True))

    def test_a_stop_that_only_ends_trips_is_that_directions_terminus(self):
        self.assertEqual(self.index["30-13201"]["0"]["final"], {"600"})

    def test_a_trailing_stop_with_no_pickup_or_drop_off_does_not_count(self):
        self.assertEqual(self.index["30-13201"]["1"]["final"], {"511"})
        self.assertNotIn("599", self.index["30-13201"]["1"]["stops"])

    def test_a_loop_that_starts_where_it_ends_has_no_terminus(self):
        self.assertEqual(self.index["94-13201"]["0"]["final"], set())


class TestTerminalIndexCache(TestCase):
    def setUp(self):
        self.cache = tempfile.TemporaryDirectory()
        self.addCleanup(self.cache.cleanup)
        terminals._memo.clear()
        self.addCleanup(terminals._memo.clear)
        self.snapshots = {"bus": read_snapshot("bus", build_archive(TERMINAL_BUS), "u")}

    def test_the_index_is_written_once_and_read_back_without_parsing_the_feed(self):
        built = TerminalIndexes(metro_profile(), self.cache.name, terminal_archives(), self.snapshots)
        self.assertEqual(built.for_source("bus")["30-13201"]["0"]["final"], {"600"})
        self.assertEqual(len([n for n in os.listdir(self.cache.name) if n.startswith("terminals-")]), 2)
        terminals._memo.clear()
        unreachable = archive_fetcher({BUS_URL: OSError("offline"), RAIL_URL: OSError("offline")})
        read_back = TerminalIndexes(metro_profile(), self.cache.name, unreachable, self.snapshots)
        self.assertEqual(read_back.for_source("bus")["30-13201"]["1"]["final"], {"511"})

    def test_an_unknown_source_has_no_index(self):
        indexes = TerminalIndexes(metro_profile(), self.cache.name, terminal_archives(), self.snapshots)
        self.assertIsNone(indexes.for_source("ferry"))


class TestDeparturesSkipArrivalsAtTheEnd(PublicResourceCase):
    def setUp(self):
        super().setUp()
        terminals._memo.clear()
        self.addCleanup(terminals._memo.clear)

    def rows(self, archives=None):
        with patch.object(public, "archive_fetch", archives or terminal_archives()):
            data, _ = self.run_resource(
                '{"resource": "public_departures", "params": {"stop": "MT:600"}}',
                {PREDICTIONS: [HUB], ROUTES: routes_by_params, STOPS: stops},
            )
        return {(row["pattern_code"], row["direction"]) for row in data["rows"]}

    def test_the_trip_that_ends_here_is_not_listed_as_a_departure(self):
        self.assertNotIn(("MT030 E", "E"), self.rows())

    def test_the_trip_that_starts_here_is_kept(self):
        self.assertIn(("MT030 W", "W"), self.rows())

    def test_a_pattern_that_matches_neither_direction_clearly_is_kept(self):
        self.assertIn(("MT030 X", "E"), self.rows())

    def test_a_departure_without_a_pattern_is_kept(self):
        self.assertIn((None, "E"), self.rows())

    def test_when_the_index_cannot_be_built_every_departure_is_kept(self):
        with patch.object(terminals, "GtfsResolver", side_effect=RuntimeError("stop_times unreadable")):
            self.assertIn(("MT030 E", "E"), self.rows())

    def test_when_a_patterns_stops_cannot_be_read_its_departures_are_kept(self):
        def failing(params):
            if params.get("pattern_code"):
                raise OSError("timeout")
            return []

        with patch.object(public, "archive_fetch", terminal_archives()):
            data, _ = self.run_resource(
                '{"resource": "public_departures", "params": {"stop": "MT:600"}}',
                {PREDICTIONS: [HUB], ROUTES: routes_by_params, STOPS: failing},
            )
        self.assertIn("MT030 E", {row["pattern_code"] for row in data["rows"]})
