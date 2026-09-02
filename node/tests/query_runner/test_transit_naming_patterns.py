import csv
import io
from unittest import TestCase

from redash.transit_naming.patterns import (
    StopIndex,
    cut_patterns,
    distance_feet,
    mca_pattern_membership,
    pattern_row,
)
from redash.transit_naming.snapshot import GtfsSnapshot
from tests.query_runner.transit_naming_fixtures import MT_STOPS_BY_ID, metro_profile
from tests.query_runner.transit_naming_gtfs_fixtures import (
    BUS_ROUTES_TXT,
    BUS_STOP_TIMES_TXT,
    BUS_STOPS_TXT,
    BUS_TRIPS_TXT,
)


def _rows(text):
    return list(csv.DictReader(io.StringIO(text)))


def build_bus_snapshot():
    routes = {row["route_id"]: row for row in _rows(BUS_ROUTES_TXT)}
    trips = tuple(_rows(BUS_TRIPS_TXT))
    stop_times_by_trip = {}
    for row in _rows(BUS_STOP_TIMES_TXT):
        stop_times_by_trip.setdefault(row["trip_id"], []).append((int(row["stop_sequence"]), row["stop_id"]))
    for entries in stop_times_by_trip.values():
        entries.sort()
    stops = {row["stop_id"]: row for row in _rows(BUS_STOPS_TXT)}
    return GtfsSnapshot("bus", "digest", routes, trips, stop_times_by_trip, stops)


SNAPSHOT = build_bus_snapshot()
NAMES = {stop_id: stop["stop_name"] for stop_id, stop in MT_STOPS_BY_ID.items()}
PROFILE = metro_profile()


def cut(route_code, gtfs_route_id):
    return cut_patterns("MT", route_code, gtfs_route_id, SNAPSHOT, MT_STOPS_BY_ID, NAMES, PROFILE)


class TestDistance(TestCase):
    def test_a_ten_thousandth_of_a_degree_is_about_36_feet(self):
        self.assertAlmostEqual(distance_feet(34.0600, -118.3000, 34.0601, -118.3000), 36.4, delta=0.5)


class TestCutPatterns(TestCase):
    def test_one_pattern_per_direction_in_stop_order(self):
        rows = cut("MT030", "30-13201")
        east = [r for r in rows if r.direction == "E"]
        self.assertEqual(
            [(r.sequence, r.stop_id) for r in east],
            [(0, "3000001"), (1, "13574"), (2, "19022"), (3, "1166")],
        )
        self.assertTrue(all(r.is_canonical for r in rows))
        self.assertEqual({r.pattern_id for r in east}, {"30_0"})
        self.assertEqual({r.sequence_source for r in rows}, {"gtfs_stop_times"})
        self.assertEqual({r.stop_match for r in rows}, {"id"})
        self.assertEqual(east[0].public_name, "Pico \\ Rimpau")

    def test_per_route_direction_map_wins(self):
        rows = cut("MT094", "94-13201")
        self.assertEqual({r.direction for r in rows}, {"N"})

    def test_branch_stops_live_on_their_own_non_canonical_pattern(self):
        rows = cut("MT720", "720-13201")
        east = [r for r in rows if r.direction == "E"]
        canonical = [r for r in east if r.is_canonical]
        branch = [r for r in east if not r.is_canonical]
        self.assertEqual([r.stop_id for r in canonical], ["1166", "13574", "9101", "9002"])
        self.assertEqual([r.stop_id for r in branch], ["1166", "13574", "9003"])
        self.assertEqual({r.pattern_id for r in branch}, {"720_0x"})

    def test_the_three_stop_match_outcomes(self):
        rows = {r.gtfs_stop_id: r for r in cut("MT720", "720-13201") if r.direction == "E" and r.is_canonical}
        self.assertEqual((rows["1166"].stop_match, rows["1166"].stop_id), ("id", "1166"))
        self.assertEqual(
            (rows["9001"].stop_match, rows["9001"].stop_id, rows["9001"].public_name),
            ("coordinate", "9101", "Wilshire Blvd/Western Ave"),
        )
        self.assertEqual(
            (rows["9002"].stop_match, rows["9002"].stop_id, rows["9002"].public_name),
            ("unmatched", "9002", "Wilshire / Normandie"),
        )

    def test_a_route_with_no_trips_yields_nothing(self):
        self.assertEqual(cut("MT009", "9-13201"), [])

    def test_row_columns(self):
        row = pattern_row(cut("MT030", "30-13201")[0], "rev", "dig")
        self.assertEqual(
            list(row),
            [
                "carrier_code",
                "route_code",
                "direction",
                "pattern_id",
                "is_canonical",
                "sequence",
                "stop_id",
                "gtfs_stop_id",
                "public_name",
                "public_name_source",
                "stop_match",
                "sequence_source",
                "normalization_revision",
                "gtfs_digest",
            ],
        )

    def test_rows_carry_the_stop_name_provenance(self):
        sources = {"1166": "rule", "13574": "override", "9101": "rule"}
        rows = cut_patterns(
            "MT", "MT720", "720-13201", SNAPSHOT, MT_STOPS_BY_ID, NAMES, PROFILE, public_sources=sources
        )
        east = {r.gtfs_stop_id: r.public_name_source for r in rows if r.direction == "E" and r.is_canonical}
        self.assertEqual(east, {"1166": "rule", "13574": "override", "9001": "rule", "9002": "passthrough"})


class TestMcaPatternMembership(TestCase):
    def test_membership_rows_have_no_sequence(self):
        stops = [
            dict(MT_STOPS_BY_ID["1166"], pattern_code="MT030 E"),
            dict(MT_STOPS_BY_ID["13574"], pattern_code="MT030 E"),
        ]
        rows = mca_pattern_membership("MT", "MT030", "MT030 E", stops, NAMES)
        self.assertEqual(
            [(r.stop_id, r.sequence, r.direction, r.pattern_id, r.is_canonical) for r in rows],
            [("1166", None, "E", "MT030 E", True), ("13574", None, "E", "MT030 E", True)],
        )
        self.assertEqual({(r.stop_match, r.sequence_source) for r in rows}, {("id", "mca_pattern")})


def snapshot_with(trips, stop_times):
    return GtfsSnapshot("bus", "digest", {"R": {}}, tuple(trips), stop_times, {})


def trip(trip_id, shape_id, direction="0"):
    return {"route_id": "R", "trip_id": trip_id, "direction_id": direction, "shape_id": shape_id, "trip_headsign": ""}


class TestReviewFindings(TestCase):
    def test_one_shape_with_two_stop_sequences_gets_distinct_pattern_ids(self):
        stop_times = {"a": [(1, "1166"), (2, "13574")], "b": [(1, "1166"), (2, "13574"), (3, "19022")]}
        snapshot = snapshot_with([trip("a", "S"), trip("b", "S")], stop_times)
        rows = cut_patterns("MT", "MTR", "R", snapshot, MT_STOPS_BY_ID, NAMES, PROFILE)
        by_pattern = {}
        for r in rows:
            by_pattern.setdefault(r.pattern_id, []).append(r.stop_id)
        self.assertEqual(by_pattern, {"S": ["1166", "13574"], "S-2": ["1166", "13574", "19022"]})
        self.assertEqual({r.pattern_id for r in rows if r.is_canonical}, {"S-2"})

    def test_generated_pattern_ids_never_collide(self):
        stop_times = {
            "a": [(1, "1166"), (2, "13574")],
            "b": [(1, "1166"), (2, "13574"), (3, "19022")],
            "c": [(1, "13574"), (2, "19022")],
            "d": [(1, "19022"), (2, "13574")],
        }
        trips = [trip("a", "S"), trip("b", "S"), trip("c", "S-2"), trip("d", "S", direction="1")]
        rows = cut_patterns("MT", "MTR", "R", snapshot_with(trips, stop_times), MT_STOPS_BY_ID, NAMES, PROFILE)
        ids = {(r.direction, r.pattern_id) for r in rows}
        self.assertEqual(len({pattern_id for _, pattern_id in ids}), 4)

    def test_coordinate_matching_uses_the_stop_index(self):
        index = StopIndex(MT_STOPS_BY_ID)
        self.assertEqual(index.nearest(34.0600, -118.3000, 130.0)["stop_id"], "9101")
        self.assertIsNone(index.nearest(34.0700, -118.3100, 130.0))
        self.assertIsNone(index.nearest(0.0, 0.0, 130.0))

    def test_index_skips_non_finite_coordinates_and_scales_to_the_threshold(self):
        stops = dict(MT_STOPS_BY_ID, bad={"stop_id": "bad", "lat": "nan", "lng": "inf"})
        index = StopIndex(stops)
        self.assertEqual(index.nearest(34.0600, -118.2750, 10000.0)["stop_id"], "9101")
        self.assertIsNone(index.nearest(34.0600, -118.2750, 130.0))
        self.assertIsNone(index.nearest(float("nan"), -118.3000, 130.0))

    def test_equal_length_canonical_tie_does_not_depend_on_trip_order(self):
        forward = [trip("a", "B"), trip("b", "A")]
        stop_times = {"a": [(1, "1166"), (2, "13574")], "b": [(1, "13574"), (2, "1166")]}
        first = cut_patterns("MT", "MTR", "R", snapshot_with(forward, stop_times), MT_STOPS_BY_ID, NAMES, PROFILE)
        backward = snapshot_with(list(reversed(forward)), stop_times)
        second = cut_patterns("MT", "MTR", "R", backward, MT_STOPS_BY_ID, NAMES, PROFILE)
        self.assertEqual({r.pattern_id for r in first if r.is_canonical}, {"B"})
        self.assertEqual({r.pattern_id for r in second if r.is_canonical}, {"B"})
