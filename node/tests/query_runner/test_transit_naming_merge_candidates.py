import math
from unittest import TestCase

from redash.transit_naming.coordinates import EARTH_RADIUS_M
from redash.transit_naming.merge_candidates import (
    DEFAULT_WITHIN_M,
    DIFFERENT_511_ID,
    MAX_WITHIN_M,
    MERGE_CANDIDATE_COLUMNS,
    MISSING_511_ID,
    merge_candidate_rows,
)
from tests.query_runner.test_metrocloudalliance_public import STOPS, PublicResourceCase
from tests.query_runner.transit_naming_fixtures import MT_STOPS, MT_STOPS_BY_ID

DEGREES_PER_METER_NORTH = 180 / (math.pi * EARTH_RADIUS_M)


class TestPublicStopMergeCandidates(PublicResourceCase):
    def stops(self, params):
        self.assertNotIn("carrier_code", params)
        corner = MT_STOPS_BY_ID["1"]
        nearby = dict(corner, carrier_code="SM", stop_id="220", uuid="uuid-sm-220", **{"511_id": "2000220"})
        nearby["lat"] = corner["lat"] + 5 * DEGREES_PER_METER_NORTH
        return MT_STOPS + [nearby]

    def test_names_every_carriers_stops_and_proposes_the_shared_corner(self):
        data, _ = self.run_resource('{"resource": "public_stop_merge_candidates"}', {STOPS: self.stops})
        self.assertEqual([c["name"] for c in data["columns"]], list(MERGE_CANDIDATE_COLUMNS))
        pairs = [(r["carrier_a"], r["stop_id_a"], r["carrier_b"], r["stop_id_b"], r["reason"]) for r in data["rows"]]
        self.assertEqual(pairs, [("MT", "1", "SM", "220", DIFFERENT_511_ID)])
        self.assertEqual(data["rows"][0]["public_name_a"], data["rows"][0]["public_name_b"])

    def test_keeps_its_columns_when_nothing_is_proposed(self):
        query = '{"resource": "public_stop_merge_candidates", "params": {"carrier_code": "LB"}}'
        data, _ = self.run_resource(query, {STOPS: self.stops})
        self.assertEqual(data["rows"], [])
        self.assertEqual([c["name"] for c in data["columns"]], list(MERGE_CANDIDATE_COLUMNS))


def stop(
    carrier,
    stop_id,
    name,
    id511,
    meters_north=0.0,
    on_street="",
    cross_street="",
    direction=None,
    retired=False,
    meters_east=0.0,
    origin=(34.0, -118.0),
):
    lat = origin[0] + meters_north * DEGREES_PER_METER_NORTH
    return {
        "carrier_code": carrier,
        "stop_id": stop_id,
        "511_id": id511,
        "public_name": name,
        "on_street": on_street,
        "cross_street": cross_street,
        "direction": direction,
        "retired": retired,
        "lat": lat,
        "lng": origin[1] + meters_east * DEGREES_PER_METER_NORTH / math.cos(math.radians(lat)),
        "normalization_revision": "r1",
    }


class TestMergeCandidateRows(TestCase):
    def rows(self, stops, **params):
        return merge_candidate_rows(stops, params)

    def test_two_carriers_naming_one_corner_under_different_511_ids_are_proposed(self):
        rows = self.rows(
            [
                stop("MT", "10224", "Valley Bl/Almansor St", "1010224"),
                stop("AT", "2619783", "Valley Bl/Almansor St", "2619783", meters_north=8),
            ]
        )
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(list(row), list(MERGE_CANDIDATE_COLUMNS))
        self.assertEqual((row["carrier_a"], row["stop_id_a"], row["511_id_a"]), ("AT", "2619783", "2619783"))
        self.assertEqual((row["carrier_b"], row["stop_id_b"], row["511_id_b"]), ("MT", "10224", "1010224"))
        self.assertEqual(row["reason"], DIFFERENT_511_ID)
        self.assertAlmostEqual(row["separation_m"], 8.0, delta=0.2)
        self.assertEqual(row["normalization_revision"], "r1")

    def test_street_order_does_not_matter(self):
        rows = self.rows(
            [
                stop("MT", "1", "Eastern Av/Ramona Bl", "1", on_street="Eastern Av", cross_street="Ramona Bl"),
                stop("CM", "2", "Ramona Bl/Eastern Av", "2", meters_north=5),
            ]
        )
        self.assertEqual([(r["carrier_a"], r["carrier_b"]) for r in rows], [("CM", "MT")])

    def test_a_stop_without_a_511_id_is_proposed_as_missing(self):
        rows = self.rows(
            [
                stop("MT", "9385", "Plummer St/Corbin Av", "1009385"),
                stop("AV", "2003", "Plummer St/Corbin Av", "", meters_north=14),
            ]
        )
        self.assertEqual([r["reason"] for r in rows], [MISSING_511_ID])

    def test_two_stops_that_both_lack_a_511_id_are_proposed_as_missing(self):
        rows = self.rows([stop("MT", "1", "A St/B St", ""), stop("DA", "2", "A St/B St", "", meters_north=4)])
        self.assertEqual([(r["511_id_a"], r["511_id_b"], r["reason"]) for r in rows], [("", "", MISSING_511_ID)])

    def test_a_name_that_is_not_an_intersection_matches_whole(self):
        rows = self.rows(
            [
                stop("MT", "1", "Elm Grove Station", "1"),
                stop("AM", "EGV", "elm  grove station", "2", meters_north=6),
                stop("DA", "3", "Elm Grove Station East", "3", meters_north=3),
            ]
        )
        self.assertEqual([(r["carrier_a"], r["carrier_b"]) for r in rows], [("AM", "MT")])

    def test_a_pair_just_inside_the_radius_is_found_wherever_it_starts_and_whichever_way_it_lies(self):
        layouts = {
            "north": {"meters_north": DEFAULT_WITHIN_M - 0.01},
            "east": {"meters_east": DEFAULT_WITHIN_M - 0.05},
            "north-east": {"meters_north": 10.5, "meters_east": 10.5},
        }
        places = ((34.0, -118.0), (60.0, 25.0), (-33.9, 151.2))
        starts_across_a_cell = [i * DEFAULT_WITHIN_M / 40 for i in range(40)]
        for label, offset in layouts.items():
            for lat, lng in places:
                for shift_m in starts_across_a_cell:
                    origin = (lat + shift_m * DEGREES_PER_METER_NORTH, lng + shift_m * DEGREES_PER_METER_NORTH)
                    with self.subTest(label, origin=origin):
                        rows = self.rows(
                            [
                                stop("MT", "1", "A St/B St", "1", origin=origin),
                                stop("DA", "2", "A St/B St", "2", origin=origin, **offset),
                            ]
                        )
                        self.assertEqual(len(rows), 1)
                        self.assertLessEqual(rows[0]["separation_m"], DEFAULT_WITHIN_M)

    def test_directions_compare_without_case_or_spacing(self):
        rows = self.rows(
            [
                stop("MT", "1", "A St/B St", "1", direction="Northbound"),
                stop("DA", "2", "A St/B St", "2", meters_north=5, direction=" northbound "),
            ]
        )
        self.assertEqual(len(rows), 1)

    def test_a_direction_known_on_one_side_only_does_not_block(self):
        rows = self.rows(
            [
                stop("MT", "1", "Main St/2nd St", "1", direction="Northbound"),
                stop("DA", "2", "Main St/2nd St", "2", meters_north=6),
            ]
        )
        self.assertEqual(len(rows), 1)

    def test_pairs_that_are_not_one_stop_are_left_alone(self):
        cases = {
            "already one 511 location": [stop("MT", "1", "A St/B St", "7"), stop("DA", "2", "A St/B St", "7", 5)],
            "same carrier": [stop("MT", "1", "A St/B St", "1"), stop("MT", "2", "A St/B St", "2", 5)],
            "retired": [stop("MT", "1", "A St/B St", "1"), stop("DA", "2", "A St/B St", "2", 5, retired=True)],
            "too far apart": [stop("MT", "1", "A St/B St", "1"), stop("DA", "2", "A St/B St", "2", 16)],
            "different corner": [stop("MT", "1", "A St/B St", "1"), stop("DA", "2", "A St/C St", "2", 5)],
            "opposite sides": [
                stop("MT", "1", "A St/B St", "1", direction="Northbound"),
                stop("DA", "2", "A St/B St", "2", 5, direction="Southbound"),
            ],
            "no coordinates": [stop("MT", "1", "A St/B St", "1"), dict(stop("DA", "2", "A St/B St", "2"), lat=None)],
        }
        for label, stops in cases.items():
            with self.subTest(label):
                self.assertEqual(self.rows(stops), [])

    def test_a_carrier_filter_keeps_only_its_pairs(self):
        stops = [
            stop("MT", "1", "A St/B St", "1"),
            stop("DA", "2", "A St/B St", "2", 5),
            stop("CE", "3", "C St/D St", "3", 200),
            stop("LB", "4", "C St/D St", "4", 205),
        ]
        self.assertEqual(len(self.rows(stops)), 2)
        self.assertEqual([r["carrier_b"] for r in self.rows(stops, carrier_code="MT")], ["MT"])

    def test_the_search_radius_is_a_parameter_with_a_ceiling(self):
        stops = [stop("MT", "1", "A St/B St", "1"), stop("DA", "2", "A St/B St", "2", 40)]
        self.assertEqual(self.rows(stops), [])
        self.assertEqual(len(self.rows(stops, within_m="45")), 1)
        far = [stop("MT", "1", "A St/B St", "1"), stop("DA", "2", "A St/B St", "2", MAX_WITHIN_M + 10)]
        self.assertEqual(self.rows(far, within_m=str(MAX_WITHIN_M * 10)), [])

    def test_a_radius_that_is_not_a_number_is_refused(self):
        with self.assertRaises(ValueError):
            self.rows([], within_m="wide")
