from unittest import TestCase

from google.transit import gtfs_realtime_pb2 as pb

from redash.query_runner.gtfs_realtime_entities import build_trip_update_rows
from tests.query_runner.gtfs_realtime_fixtures import (
    build_stop_time_update,
    build_trip_update_entity,
)

SCHEDULED_TRIP = pb.TripDescriptor.SCHEDULED
CANCELED_TRIP = pb.TripDescriptor.CANCELED
SCHEDULED_STOP = pb.TripUpdate.StopTimeUpdate.SCHEDULED
SKIPPED_STOP = pb.TripUpdate.StopTimeUpdate.SKIPPED


class TestBuildTripUpdateRows(TestCase):
    def test_row_shape_with_mixed_arrival_departure_presence(self):
        entity = build_trip_update_entity(
            entity_id="t-1",
            trip_id="trip-1",
            route_id="10",
            direction_id=0,
            vehicle_id="veh-1",
            timestamp=1752940000,
            stop_time_updates=[
                build_stop_time_update(
                    stop_id="s1",
                    stop_sequence=1,
                    arrival_delay=30,
                    arrival_time=1752940100,
                ),
                build_stop_time_update(
                    stop_id="s2",
                    stop_sequence=2,
                    departure_delay=45,
                    departure_time=1752940200,
                ),
            ],
        )
        rows = build_trip_update_rows(entity, {"10": "Blue Line"}, 60, 300)
        self.assertEqual(len(rows), 2)

        first, second = rows
        self.assertEqual(first["trip_id"], "trip-1")
        self.assertEqual(first["route_id"], "10")
        self.assertEqual(first["line"], "Blue Line")
        self.assertEqual(first["direction_id"], 0)
        self.assertEqual(first["vehicle_id"], "veh-1")
        self.assertEqual(first["stop_id"], "s1")
        self.assertEqual(first["stop_sequence"], 1)
        self.assertEqual(first["arrival_delay"], 30)
        self.assertIsNone(first["departure_delay"])
        self.assertEqual(first["arrival_time"], "2025-07-19 15:48:20")
        self.assertIsNone(first["departure_time"])
        self.assertEqual(first["trip_schedule_relationship"], "SCHEDULED")
        self.assertEqual(first["stop_schedule_relationship"], "SCHEDULED")
        self.assertEqual(first["timestamp"], "2025-07-19 15:46:40")
        self.assertTrue(first["on_time"])

        self.assertIsNone(second["arrival_delay"])
        self.assertEqual(second["departure_delay"], 45)
        self.assertEqual(second["stop_id"], "s2")

    def test_two_trips_produce_rows_scoped_to_their_own_trip(self):
        entity_a = build_trip_update_entity(
            entity_id="a",
            trip_id="trip-a",
            route_id="10",
            stop_time_updates=[build_stop_time_update(stop_id="s1", arrival_delay=0)],
        )
        entity_b = build_trip_update_entity(
            entity_id="b",
            trip_id="trip-b",
            route_id="20",
            stop_time_updates=[build_stop_time_update(stop_id="s9", arrival_delay=0)],
        )
        rows_a = build_trip_update_rows(entity_a, {}, 60, 300)
        rows_b = build_trip_update_rows(entity_b, {}, 60, 300)
        self.assertEqual([r["trip_id"] for r in rows_a], ["trip-a"])
        self.assertEqual([r["trip_id"] for r in rows_b], ["trip-b"])

    def test_unset_optional_fields_absent_map_to_expected_defaults(self):
        entity = build_trip_update_entity(
            entity_id="e-1",
            stop_time_updates=[build_stop_time_update()],
        )
        rows = build_trip_update_rows(entity, {}, 60, 300)
        row = rows[0]
        self.assertEqual(row["trip_id"], "")
        self.assertEqual(row["route_id"], "")
        self.assertEqual(row["line"], "")
        self.assertIsNone(row["direction_id"])
        self.assertEqual(row["vehicle_id"], "")
        self.assertEqual(row["stop_id"], "")
        self.assertIsNone(row["stop_sequence"])
        self.assertIsNone(row["arrival_delay"])
        self.assertIsNone(row["departure_delay"])
        self.assertIsNone(row["arrival_time"])
        self.assertIsNone(row["departure_time"])
        self.assertIsNone(row["timestamp"])
        self.assertEqual(row["trip_schedule_relationship"], "SCHEDULED")
        self.assertEqual(row["stop_schedule_relationship"], "SCHEDULED")

    def test_explicit_zero_delay_and_timestamp_are_not_treated_as_absent(self):
        entity = build_trip_update_entity(
            entity_id="e-1",
            timestamp=0,
            stop_time_updates=[build_stop_time_update(arrival_delay=0)],
        )
        rows = build_trip_update_rows(entity, {}, 60, 300)
        row = rows[0]
        self.assertEqual(row["timestamp"], "1970-01-01 00:00:00")
        self.assertEqual(row["arrival_delay"], 0)
        self.assertTrue(row["on_time"])

    def test_unknown_route_kept_verbatim(self):
        entity = build_trip_update_entity(
            entity_id="e-1",
            route_id="99",
            stop_time_updates=[build_stop_time_update()],
        )
        rows = build_trip_update_rows(entity, {}, 60, 300)
        self.assertEqual(rows[0]["line"], "99")

    def test_entity_without_trip_update_yields_no_rows(self):
        entity = pb.FeedEntity()
        entity.id = "vehicle-only"
        entity.vehicle.position.latitude = 1.0
        entity.vehicle.position.longitude = 2.0
        self.assertEqual(build_trip_update_rows(entity, {}, 60, 300), [])


class TestOnTimeBoundaries(TestCase):
    def _delay_on_time(self, delay, early_seconds=60, late_seconds=300):
        entity = build_trip_update_entity(
            entity_id="e",
            stop_time_updates=[build_stop_time_update(arrival_delay=delay)],
        )
        rows = build_trip_update_rows(entity, {}, early_seconds, late_seconds)
        return rows[0]["on_time"]

    def test_early_boundary_exact_is_on_time(self):
        self.assertTrue(self._delay_on_time(-60, early_seconds=60))

    def test_early_boundary_one_second_beyond_is_not_on_time(self):
        self.assertFalse(self._delay_on_time(-61, early_seconds=60))

    def test_late_boundary_exact_is_on_time(self):
        self.assertTrue(self._delay_on_time(300, late_seconds=300))

    def test_late_boundary_one_second_beyond_is_not_on_time(self):
        self.assertFalse(self._delay_on_time(301, late_seconds=300))


class TestOnTimeNoneCases(TestCase):
    def test_none_for_skipped_stop(self):
        entity = build_trip_update_entity(
            entity_id="e",
            stop_time_updates=[build_stop_time_update(arrival_delay=0, schedule_relationship=SKIPPED_STOP)],
        )
        rows = build_trip_update_rows(entity, {}, 60, 300)
        self.assertIsNone(rows[0]["on_time"])

    def test_none_for_canceled_trip(self):
        entity = build_trip_update_entity(
            entity_id="e",
            trip_schedule_relationship=CANCELED_TRIP,
            stop_time_updates=[build_stop_time_update(arrival_delay=0)],
        )
        rows = build_trip_update_rows(entity, {}, 60, 300)
        self.assertIsNone(rows[0]["on_time"])

    def test_none_when_both_delays_absent(self):
        entity = build_trip_update_entity(
            entity_id="e",
            stop_time_updates=[build_stop_time_update(stop_id="s1")],
        )
        rows = build_trip_update_rows(entity, {}, 60, 300)
        self.assertIsNone(rows[0]["on_time"])

    def test_departure_delay_used_when_arrival_absent(self):
        entity = build_trip_update_entity(
            entity_id="e",
            stop_time_updates=[build_stop_time_update(departure_delay=500)],
        )
        rows = build_trip_update_rows(entity, {}, 60, 300)
        self.assertFalse(rows[0]["on_time"])

    def test_arrival_delay_takes_precedence_over_departure_delay(self):
        entity = build_trip_update_entity(
            entity_id="e",
            stop_time_updates=[build_stop_time_update(arrival_delay=0, departure_delay=5000)],
        )
        rows = build_trip_update_rows(entity, {}, 60, 300)
        self.assertTrue(rows[0]["on_time"])
