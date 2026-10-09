from unittest import TestCase

from redash.transit_naming.gtfs_shapes import path_rows
from redash.transit_naming.patterns import cut_patterns
from redash.transit_naming.snapshot import GtfsSnapshot
from tests.query_runner.transit_naming_fixtures import metro_profile

ROUTES = {"R1": {"route_id": "R1"}, "R2": {"route_id": "R2"}}
TRIPS = (
    {"route_id": "R1", "trip_id": "a", "direction_id": "", "shape_id": "sa", "trip_headsign": "Out"},
    {"route_id": "R1", "trip_id": "b", "direction_id": "", "shape_id": "sb", "trip_headsign": "Back"},
    {"route_id": "R1", "trip_id": "c", "direction_id": "", "shape_id": "sc", "trip_headsign": "Short"},
    {"route_id": "R2", "trip_id": "d", "direction_id": "0", "shape_id": "sd", "trip_headsign": "Long"},
    {"route_id": "R2", "trip_id": "e", "direction_id": "0", "shape_id": "se", "trip_headsign": "Short"},
    {"route_id": "R2", "trip_id": "f", "direction_id": "1", "shape_id": "sf", "trip_headsign": "Back"},
)
STOP_TIMES = {
    "a": [(1, "s1"), (2, "s2"), (3, "s3")],
    "b": [(1, "s3"), (2, "s2"), (3, "s1")],
    "c": [(1, "s1"), (2, "s2")],
    "d": [(1, "s1"), (2, "s2"), (3, "s3")],
    "e": [(1, "s1"), (2, "s2")],
    "f": [(1, "s3"), (2, "s1")],
}
SNAPSHOT = GtfsSnapshot("bus", "digest", ROUTES, TRIPS, STOP_TIMES, {}, {})
PROFILE = metro_profile()


def cut(gtfs_route_id):
    return cut_patterns("MT", "MT001", gtfs_route_id, SNAPSHOT, {}, {}, PROFILE)


def paths(gtfs_route_id):
    return path_rows("MT", "MT001", gtfs_route_id, SNAPSHOT, PROFILE, "digest")


class TestRoutesWithoutDirection(TestCase):
    def test_every_pattern_of_a_route_without_direction_id_is_canonical_in_stops(self):
        rows = cut("R1")
        self.assertEqual({r.pattern_id for r in rows}, {"sa", "sb", "sc"})
        self.assertTrue(all(r.is_canonical for r in rows))
        self.assertEqual({r.direction_id for r in rows}, {None})

    def test_every_pattern_of_a_route_without_direction_id_is_canonical_in_paths(self):
        rows = paths("R1")
        self.assertEqual({r["pattern_id"] for r in rows}, {"sa", "sb", "sc"})
        self.assertTrue(all(r["is_canonical"] for r in rows))
        self.assertEqual({r["direction_id"] for r in rows}, {None})


class TestRoutesWithDirection(TestCase):
    def test_longest_per_direction_stays_canonical_in_stops(self):
        flags = {r.pattern_id: r.is_canonical for r in cut("R2")}
        self.assertEqual(flags, {"sd": True, "se": False, "sf": True})

    def test_longest_per_direction_stays_canonical_in_paths(self):
        flags = {r["pattern_id"]: r["is_canonical"] for r in paths("R2")}
        self.assertEqual(flags, {"sd": True, "se": False, "sf": True})
