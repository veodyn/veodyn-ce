from unittest import TestCase

from redash.transit_naming.gtfs_routes import read_snapshot
from redash.transit_naming.patterns import cut_patterns
from redash.transit_naming.snapshot import GtfsSnapshot
from tests.query_runner.transit_naming_fixtures import MT_STOPS_BY_ID, metro_profile
from tests.query_runner.transit_naming_gtfs_fixtures import BUS_MEMBERS, build_archive

PROFILE = metro_profile()
NAMES = {stop_id: stop["stop_name"] for stop_id, stop in MT_STOPS_BY_ID.items()}
GTFS_STOPS = {
    "1166": {"stop_id": "1166", "stop_name": "1st / Main", "stop_lat": "34.051917", "stop_lon": "-118.243244"},
    "13574": {"stop_id": "13574", "stop_name": "Grand / Pico", "stop_lat": "34.0400", "stop_lon": "-118.2600"},
    "19022": {"stop_id": "19022", "stop_name": "Broadway / 5th", "stop_lat": "34.0480", "stop_lon": "-118.2510"},
    "9800": {"stop_id": "9800", "stop_name": "Grand / Pico Layover", "stop_lat": "0", "stop_lon": "0"},
    "9801": {"stop_id": "9801", "stop_name": "Bus Yard", "stop_lat": "0", "stop_lon": "0"},
    "9802": {"stop_id": "9802", "stop_name": "Main Layover-Boarding Dock", "stop_lat": "0", "stop_lon": "0"},
}


def trip(trip_id, shape_id, direction="0"):
    return {"route_id": "R", "trip_id": trip_id, "direction_id": direction, "shape_id": shape_id, "trip_headsign": ""}


def snapshot(trips, stop_times, no_service=None):
    return GtfsSnapshot(
        "bus", "digest", {"R": {}}, tuple(trips), stop_times, GTFS_STOPS, {}, no_service_stop_times=no_service or {}
    )


def cut(snap, mca_stops=MT_STOPS_BY_ID, names=NAMES):
    return cut_patterns("MT", "MTR", "R", snap, mca_stops, names, PROFILE)


def stops_of(rows, pattern_id):
    return [(r.sequence, r.gtfs_stop_id) for r in rows if r.pattern_id == pattern_id]


class TestNoServiceStops(TestCase):
    def test_a_stop_with_no_pickup_and_no_drop_off_on_every_trip_is_not_a_passenger_stop(self):
        times = [(1, "1166"), (2, "13574"), (3, "19022"), (4, "9801")]
        snap = snapshot([trip("a", "S"), trip("b", "S")], {"a": times, "b": times}, {"a": {4}, "b": {4}})
        rows = cut(snap)
        self.assertEqual(stops_of(rows, "S"), [(0, "1166"), (1, "13574"), (2, "19022")])
        self.assertEqual({(r.pattern_id, r.is_canonical) for r in rows}, {("S", True)})

    def test_a_stop_served_by_any_trip_of_the_pattern_stays(self):
        times = [(1, "1166"), (2, "13574"), (3, "19022")]
        snap = snapshot([trip("a", "S"), trip("b", "S")], {"a": times, "b": times}, {"a": {3}})
        self.assertEqual(stops_of(cut(snap), "S"), [(0, "1166"), (1, "13574"), (2, "19022")])

    def test_a_mid_pattern_pass_through_drops_and_the_sequence_stays_contiguous(self):
        times = [(1, "1166"), (2, "13574"), (3, "19022")]
        snap = snapshot([trip("a", "S")], {"a": times}, {"a": {2}})
        self.assertEqual(stops_of(cut(snap), "S"), [(0, "1166"), (1, "19022")])

    def test_pattern_ids_and_the_canonical_choice_ignore_the_flags(self):
        long_times = [(1, "1166"), (2, "13574"), (3, "19022"), (4, "9801")]
        short_times = [(1, "1166"), (2, "13574"), (3, "19022")]
        trips = [trip("a", "LONG"), trip("b", "SHORT")]
        snap = snapshot(trips, {"a": long_times, "b": short_times}, {"a": {4}})
        rows = cut(snap)
        self.assertEqual({r.pattern_id for r in rows if r.is_canonical}, {"LONG"})
        self.assertEqual(stops_of(rows, "LONG"), stops_of(rows, "SHORT"))


class TestLayoverNamedStops(TestCase):
    def test_a_layover_at_the_end_of_a_pattern_is_trimmed_so_the_terminus_is_the_last_real_stop(self):
        times = [(1, "1166"), (2, "13574"), (3, "19022"), (4, "9800")]
        rows = cut(snapshot([trip("a", "S")], {"a": times}))
        self.assertEqual(stops_of(rows, "S"), [(0, "1166"), (1, "13574"), (2, "19022")])
        self.assertNotIn("Layover", rows[-1].public_name)

    def test_a_layover_at_the_start_of_a_pattern_is_trimmed(self):
        times = [(1, "9800"), (2, "1166"), (3, "13574")]
        self.assertEqual(stops_of(cut(snapshot([trip("a", "S")], {"a": times})), "S"), [(0, "1166"), (1, "13574")])

    def test_the_carrier_name_flags_a_layover_the_feed_name_does_not(self):
        mca = dict(MT_STOPS_BY_ID, **{"19022": dict(MT_STOPS_BY_ID["19022"], stop_name="Broadway / 5th LAYOVER")})
        names = dict(NAMES, **{"19022": "Broadway/5th LAYOVER"})
        times = [(1, "1166"), (2, "13574"), (3, "19022")]
        rows = cut(snapshot([trip("a", "S")], {"a": times}), mca, names)
        self.assertEqual(stops_of(rows, "S"), [(0, "1166"), (1, "13574")])

    def test_a_layover_name_between_served_stops_stays(self):
        times = [(1, "1166"), (2, "9800"), (3, "13574")]
        rows = cut(snapshot([trip("a", "S")], {"a": times}))
        self.assertEqual(stops_of(rows, "S"), [(0, "1166"), (1, "9800"), (2, "13574")])

    def test_layover_only_as_a_word_inside_a_boarding_place_name_stays(self):
        times = [(1, "9802"), (2, "1166"), (3, "13574")]
        rows = cut(snapshot([trip("a", "S")], {"a": times}))
        self.assertEqual([r.gtfs_stop_id for r in rows], ["9802", "1166", "13574"])

    def test_a_no_service_yard_then_a_layover_both_leave_the_end(self):
        times = [(1, "1166"), (2, "13574"), (3, "9800"), (4, "9801")]
        rows = cut(snapshot([trip("a", "S")], {"a": times}, {"a": {4}}))
        self.assertEqual(stops_of(rows, "S"), [(0, "1166"), (1, "13574")])


STOP_TIMES_WITH_FLAGS = (
    "trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n"
    "t1,06:00:00,06:00:00,1166,1,0,0\n"
    "t1,06:05:00,06:05:00,13574,2,1,0\n"
    "t1,06:09:00,06:09:00,19022,3,1,1\n"
)


class TestSnapshotReadsTheServiceFlags(TestCase):
    def test_only_no_pickup_and_no_drop_off_together_count(self):
        content = build_archive(dict(BUS_MEMBERS, **{"stop_times.txt": STOP_TIMES_WITH_FLAGS}))
        snap = read_snapshot("bus", content, "https://example/bus.zip", with_patterns=True)
        self.assertEqual(snap.no_service_stop_times, {"t1": frozenset({3})})
        self.assertEqual(snap.stop_times_by_trip["t1"], [(1, "1166"), (2, "13574"), (3, "19022")])

    def test_a_feed_without_the_columns_has_no_flags(self):
        snap = read_snapshot("bus", build_archive(BUS_MEMBERS), "https://example/bus.zip", with_patterns=True)
        self.assertEqual(snap.no_service_stop_times, {})
