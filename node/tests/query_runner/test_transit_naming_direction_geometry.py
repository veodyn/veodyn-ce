from dataclasses import replace
from unittest import TestCase

from redash.transit_naming.gtfs_shapes import path_rows
from redash.transit_naming.patterns import cut_patterns
from redash.transit_naming.profile_loader import parse_profile_yaml
from redash.transit_naming.profiles import ProfileError
from redash.transit_naming.snapshot import GtfsSnapshot
from tests.query_runner.transit_naming_fixtures import metro_profile

STOPS = {
    "south": {"stop_id": "south", "stop_name": "Main St/1st St", "stop_lat": "34.00", "stop_lon": "-118.25"},
    "middle": {"stop_id": "middle", "stop_name": "Main St/5th St", "stop_lat": "34.05", "stop_lon": "-118.26"},
    "north": {"stop_id": "north", "stop_name": "Main St/9th St", "stop_lat": "34.10", "stop_lon": "-118.24"},
    "east": {"stop_id": "east", "stop_name": "Pico Bl/Main St", "stop_lat": "34.04", "stop_lon": "-118.20"},
    "west": {"stop_id": "west", "stop_name": "Pico Bl/Rimpau Bl", "stop_lat": "34.05", "stop_lon": "-118.35"},
}
ROUTES = {"94-1": {"route_id": "94-1"}, "35-1": {"route_id": "35-1"}, "611-1": {"route_id": "611-1"}}
TRIPS = (
    {"route_id": "94-1", "trip_id": "up", "direction_id": "0", "shape_id": ""},
    {"route_id": "94-1", "trip_id": "down", "direction_id": "1", "shape_id": ""},
    {"route_id": "35-1", "trip_id": "west", "direction_id": "0", "shape_id": ""},
    {"route_id": "35-1", "trip_id": "east", "direction_id": "1", "shape_id": ""},
    {"route_id": "611-1", "trip_id": "loop", "direction_id": "0", "shape_id": ""},
)
STOP_TIMES = {
    "up": [(1, "south"), (2, "middle"), (3, "north")],
    "down": [(1, "north"), (2, "middle"), (3, "south")],
    "west": [(1, "east"), (2, "west")],
    "east": [(1, "west"), (2, "east")],
    "loop": [(1, "east"), (2, "west"), (3, "east")],
}
SNAPSHOT = GtfsSnapshot("bus", "digest", ROUTES, TRIPS, STOP_TIMES, STOPS)
MAPPED = replace(metro_profile(), direction_map_by_route={})
GEOMETRY = replace(MAPPED, direction_from="geometry")


def letters(profile, route_code, gtfs_route_id):
    rows = cut_patterns("MT", route_code, gtfs_route_id, SNAPSHOT, {}, {}, profile)
    return {row.direction_id: row.direction for row in rows}


class TestTheCompassLetterFollowsTheRouteOnTheMap(TestCase):
    def test_a_north_south_line_reads_northbound_and_southbound(self):
        self.assertEqual(letters(GEOMETRY, "MT094", "94-1"), {0: "N", 1: "S"})

    def test_a_line_whose_first_direction_runs_west_reads_westbound_first(self):
        self.assertEqual(letters(GEOMETRY, "MT035", "35-1"), {0: "W", 1: "E"})

    def test_a_loop_with_no_net_travel_falls_back_to_the_direction_map(self):
        self.assertEqual(letters(GEOMETRY, "MT611", "611-1"), {0: "E"})

    def test_a_per_route_entry_still_wins(self):
        pinned = replace(GEOMETRY, direction_map_by_route={"MT094": {"0": "E", "1": "W"}})
        self.assertEqual(letters(pinned, "MT094", "94-1"), {0: "E", 1: "W"})

    def test_without_the_option_the_direction_map_applies(self):
        self.assertEqual(letters(MAPPED, "MT094", "94-1"), {0: "E", 1: "W"})

    def test_route_paths_carry_the_same_letters_as_route_stops(self):
        rows = path_rows("MT", "MT094", "94-1", SNAPSHOT, GEOMETRY, "digest")
        self.assertEqual({row["direction_id"]: row["direction"] for row in rows}, {0: "N", 1: "S"})


class TestTheDirectionSourceIsChecked(TestCase):
    def test_geometry_and_map_are_accepted(self):
        for value in ("geometry", "map"):
            profile = parse_profile_yaml(f"carrier_code: ZZ\ndirection_from: {value}\n", "ZZ.yaml")
            self.assertEqual(profile.direction_from, value)

    def test_a_bare_profile_reads_the_direction_map(self):
        self.assertEqual(parse_profile_yaml("carrier_code: ZZ\n", "ZZ.yaml").direction_from, "map")

    def test_a_carrier_inheriting_the_default_takes_its_direction_source(self):
        default_data = {"carrier_code": "default", "direction_from": "geometry"}
        inheriting = parse_profile_yaml("carrier_code: ZZ\ninherit_default: true\n", "ZZ.yaml", default_data)
        self.assertEqual(inheriting.direction_from, "geometry")

    def test_anything_else_is_refused(self):
        with self.assertRaises(ProfileError):
            parse_profile_yaml("carrier_code: ZZ\ndirection_from: headsign\n", "ZZ.yaml")
