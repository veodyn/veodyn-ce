from unittest import TestCase

from redash.transit_naming.name_gate import check_direction, check_route, check_stop
from redash.transit_naming.profile_loader import CORE_PROFILE_DIR, build_profile_set
from redash.transit_naming.stop_shapes import stop_evidence

PARTNER = build_profile_set([CORE_PROFILE_DIR]).for_carrier("BF", "Partner")
EVIDENCE = stop_evidence({}, PARTNER)


def rules(name):
    return check_stop(name, EVIDENCE)[0]


class TestTheGateFindsEachBrokenStopRule(TestCase):
    def test_two_streets_joined_by_a_word_break_s1(self):
        self.assertEqual(rules("Elm Av and Oak St"), ["S1"])
        self.assertEqual(rules("Route 66 & Oak St"), ["S1"])

    def test_a_spelled_out_or_periodized_designation_breaks_s2(self):
        self.assertEqual(rules("Elm Avenue/Oak St"), ["S2"])
        self.assertEqual(rules("Elm Av./Oak St"), ["S2"])

    def test_an_abbreviated_way_breaks_s3(self):
        self.assertEqual(rules("Elm Av/Oak Wy"), ["S3"])

    def test_a_compass_letter_without_a_house_number_breaks_s6(self):
        self.assertEqual(rules("N Elm Av/Oak St"), ["S6"])
        self.assertEqual(rules("1402 S Elm Av"), [])

    def test_periods_in_an_acronym_break_s7_and_park_and_ride_variants_break_s8(self):
        self.assertEqual(rules("L.A. Harbor Station"), ["S7"])
        self.assertEqual(rules("Lakeside Park and Ride"), ["S8"])

    def test_a_capitalized_join_word_breaks_s9(self):
        self.assertEqual(rules("Elm Av At Lakeside Senior Center"), ["S9"])


class TestTheGatePassesWhatTheSheetKeeps(TestCase):
    def test_intersections_landmarks_stations_and_between_stops_pass(self):
        for name in (
            "Elm Av/Oak St",
            "Elm Av & Lakeside Plaza",
            "Elm Av between Oak St and Pine St",
            "9th Street/Lakeside Center Station",
            "Orr and Day Rd/Clark St",
            "Park & Ride",
        ):
            self.assertEqual(rules(name), [], name)

    def test_each_name_gets_a_shape(self):
        self.assertEqual(check_stop("Elm Av & Lakeside Plaza", EVIDENCE)[1], "STREET & LANDMARK")


class TestRoutesAndDirections(TestCase):
    def test_a_lower_case_line_breaks_r1_and_a_raw_code_is_reported_as_kept(self):
        self.assertEqual(check_route("Lakeside Transit line 4"), ["R1"])
        self.assertEqual(check_route("Lakeside Transit Line BLU"), ["R0"])
        self.assertEqual(check_route("Lakeside Transit Line 4"), [])

    def test_a_lower_case_direction_label_breaks_d1(self):
        self.assertEqual(check_direction("southbound to Lakeside"), ["D1"])
        self.assertEqual(check_direction("Southbound to Lakeside"), [])


class TestTheClassifierReadsStreetsByEvidence(TestCase):
    def test_a_street_with_a_direction_after_its_designation_is_a_street(self):
        self.assertEqual(check_stop("15th St West/Lakeside Clinic", EVIDENCE)[1], "STREET / LANDMARK")

    def test_an_acronym_that_looks_like_a_designation_is_not_a_street(self):
        self.assertEqual(check_stop("AV Mall", EVIDENCE)[1], "LANDMARK")
        self.assertEqual(check_stop("Av J-7/Elm St", EVIDENCE)[1], "STREET / STREET")

    def test_a_long_designation_on_a_segment_read_as_a_landmark_still_fails(self):
        self.assertEqual(rules("Lakeside Mall/Elm Boulevard North Gate Plaza Boulevard"), ["S2"])

    def test_a_street_rule_broken_inside_a_note_fails(self):
        self.assertEqual(rules("Elm St/Oak St (Pine Avenue)"), ["S2"])

    def test_a_station_name_inside_a_note_passes(self):
        self.assertEqual(rules("Elm St/Oak St (9th Street/Lakeside Center Station)"), [])
