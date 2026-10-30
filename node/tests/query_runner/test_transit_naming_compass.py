from dataclasses import replace
from unittest import TestCase

from redash.transit_naming.profile_loader import parse_profile_yaml
from redash.transit_naming.profiles import ProfileError
from redash.transit_naming.stops import name_stop, normalize_part
from tests.query_runner.transit_naming_fixtures import metro_profile

METRO = metro_profile(with_overrides=False)


def with_trailing_compass(value):
    return replace(METRO, stop_name=replace(METRO.stop_name, trailing_compass=value))


STREET_POSTFIX = with_trailing_compass("street")
TRAVEL_LETTER = with_trailing_compass("direction")


def stop(name, on="", cross=""):
    return {
        "stop_id": "x",
        "stop_name": name,
        "on_street": on,
        "cross_street": cross,
        "street_direction": "",
        "transit_modes": "BUS",
        "prediction_count": 1,
    }


class TestALeadingCompassPointIsSpelledOut(TestCase):
    def test_without_a_house_number(self):
        rules = METRO.stop_name
        self.assertEqual(normalize_part("N Broadway", rules), "North Broadway")
        self.assertEqual(normalize_part("S Venice Blvd", rules), "South Venice Bl")
        self.assertEqual(normalize_part("W. Third St", rules), "West Third St")
        self.assertEqual(normalize_part("E 103rd St", rules), "East 103rd St")

    def test_with_a_house_number_it_stays_abbreviated(self):
        self.assertEqual(normalize_part("2725 S Main St", METRO.stop_name), "2725 S Main St")

    def test_a_lettered_street_and_a_middle_initial_are_not_compass_points(self):
        rules = METRO.stop_name
        self.assertEqual(normalize_part("E St", rules), "E St")
        self.assertEqual(normalize_part("Cesar E Chavez Ave", rules), "Cesar E Chavez Av")
        self.assertEqual(normalize_part("N", rules), "N")

    def test_in_an_intersection(self):
        self.assertEqual(name_stop(stop("N Broadway/Alpine St"), METRO).public_name, "North Broadway/Alpine St")


class TestCornerNotesLeaveTheName(TestCase):
    def test_slash_corner_notes_in_every_truncation(self):
        for raw in (
            "Alondra Bl/Madris Av - N/E Corner",
            "Alondra Bl/Madris Av- N/E Co",
            "Alondra Bl/Madris Av N/E C",
            "Alondra Bl/Madris Av- N/",
            "Alondra Bl/Madris Av- N",
            "Alondra Bl/Madris Av-",
        ):
            self.assertEqual(name_stop(stop(raw), METRO).public_name, "Alondra Bl/Madris Av", raw)

    def test_a_diagonal_corner(self):
        self.assertEqual(name_stop(stop("Atlantic Av & 4th St NW"), METRO).public_name, "Atlantic Av/4th St")
        self.assertEqual(name_stop(stop("ATLANTIC AV & 4TH ST NW"), METRO).public_name, "Atlantic Av/4th St")

    def test_loop_and_stop_code_notes(self):
        self.assertEqual(name_stop(stop("Main St & 54th St. (CCW)"), METRO).public_name, "Main St/54th St")
        name = name_stop(stop("Soto St & Valley Blvd (Northbound) (4218)"), METRO)
        self.assertEqual((name.public_name, name.direction), ("Soto St/Valley Bl", "Northbound"))

    def test_acronyms_lose_their_periods_with_the_designations(self):
        self.assertEqual(name_stop(stop("Broadway & L.B. Blvd."), METRO).public_name, "Broadway/LB Bl")

    def test_a_mixed_case_word_is_not_a_corner(self):
        self.assertEqual(name_stop(stop("Main St/Se Plaza Dr"), METRO).public_name, "Main St/Se Plaza Dr")


class TestTrailingCompassLetterFollowsTheProfile(TestCase):
    def test_kept_by_default(self):
        self.assertEqual(normalize_part("Palos Verdes Dr N", METRO.stop_name), "Palos Verdes Dr N")

    def test_as_part_of_the_street_name_it_is_spelled_out(self):
        rules = STREET_POSTFIX.stop_name
        self.assertEqual(normalize_part("10th St. W.", rules), "10th St West")
        self.assertEqual(normalize_part("Palos Verdes Dr N", rules), "Palos Verdes Dr North")
        self.assertEqual(normalize_part("Ave S", rules), "Av S")

    def test_as_a_travel_direction_it_leaves_the_name(self):
        for raw in ("Azusa Ave/Cypress St N", "Azusa Ave/Cypress St N."):
            name = name_stop(stop(raw), TRAVEL_LETTER)
            self.assertEqual((name.public_name, name.direction), ("Azusa Av/Cypress St", "Northbound"), raw)

    def test_a_lettered_avenue_is_not_a_travel_direction(self):
        name = name_stop(stop("California Ave/Ave E"), TRAVEL_LETTER)
        self.assertEqual((name.public_name, name.direction), ("California Av/Av E", ""))

    def test_the_profile_refuses_an_unknown_value(self):
        text = "carrier_code: XX\nstop_name:\n  trailing_compass: sideways\n"
        with self.assertRaises(ProfileError) as raised:
            parse_profile_yaml(text, "XX.yaml")
        self.assertIn("trailing_compass", str(raised.exception))

    def test_the_profile_reads_the_value(self):
        text = "carrier_code: XX\nstop_name:\n  trailing_compass: direction\n"
        self.assertEqual(parse_profile_yaml(text, "XX.yaml").stop_name.trailing_compass, "direction")
