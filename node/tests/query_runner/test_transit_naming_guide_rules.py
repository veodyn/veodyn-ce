from unittest import TestCase

from redash.transit_naming.profile_loader import CORE_PROFILE_DIR, build_profile_set
from redash.transit_naming.stops import name_stop

PARTNER = build_profile_set([CORE_PROFILE_DIR]).for_carrier("BF", "Partner")


def named(raw):
    name = name_stop({"stop_id": "x", "stop_name": raw, "transit_modes": "BUS", "prediction_count": 1}, PARTNER)
    return name.public_name, name.stop_kind


class TestTwoStreetsAreAnIntersectionWhateverJoinsThem(TestCase):
    def test_and_at_and_the_at_sign_between_two_streets_become_a_slash(self):
        self.assertEqual(named("Bellflower Blvd and Rosencrans Ave"), ("Bellflower Bl/Rosencrans Av", "intersection"))
        self.assertEqual(named("Lakewood Blvd at Paramount Pl"), ("Lakewood Bl/Paramount Pl", "intersection"))
        self.assertEqual(named("N. Main St @ River Rd"), ("North Main St/River Rd", "intersection"))

    def test_way_circle_and_terrace_are_spelled_out_in_the_joined_streets(self):
        self.assertEqual(
            named("Olive St at General Thaddeus Kosciuszko Wy")[0], "Olive St/General Thaddeus Kosciuszko Way"
        )

    def test_a_stop_between_two_streets_is_not_an_intersection(self):
        self.assertEqual(
            named("Lakewood Blvd between Oak St and Mayne St")[0], "Lakewood Bl between Oak St and Mayne St"
        )


class TestLandmarksKeepTheirOwnNames(TestCase):
    def test_the_landmark_is_left_as_written(self):
        self.assertEqual(named("Flower St & Civic Center Plaza")[0], "Flower St & Civic Center Plaza")

    def test_the_street_beside_a_landmark_follows_the_street_rules(self):
        self.assertEqual(named("Bellflower Blvd-St. Johns High School")[0], "Bellflower Bl-St. Johns High School")
        self.assertEqual(named("1260 E Ontario Ave. @ Albertsons")[0], "1260 E Ontario Av @ Albertsons")


class TestLosAngelesIsWrittenWithoutPeriods(TestCase):
    def test_la_loses_its_periods(self):
        self.assertEqual(named("L.A. Harbor Station")[0], "LA Harbor Station")
        self.assertEqual(named("East L.A. College")[0], "East LA College")

    def test_a_stop_on_one_street_between_two_others_keeps_its_join(self):
        self.assertEqual(named("87th St & Stevens Dr/Laramie Ave")[0], "87th St & Stevens Dr/Laramie Av")


class TestStreetsInsideLongerNames(TestCase):
    def test_a_note_in_brackets_after_the_streets_stays(self):
        self.assertEqual(named("Foothill Blvd & Glenoaks Blvd (Arriving)")[0], "Foothill Bl/Glenoaks Bl (Arriving)")
        self.assertEqual(named("COLORADO AVE & 17TH ST (17TH ST STATION)")[0], "Colorado Av/17th St (17th St Station)")

    def test_a_compass_point_opening_a_name_is_spelled_out(self):
        self.assertEqual(named("S. Main Dr @ Via Del Rio")[0], "South Main Dr/Via Del Rio")
        self.assertEqual(named("Main St & W Hotel")[0], "Main St & W Hotel")
        self.assertEqual(named("Main St @ S. Mark Taper Foundation")[0], "Main St @ S. Mark Taper Foundation")
        self.assertEqual(named("S. Avenida Del Vista @ Library")[0], "South Avenida Del Vista @ Library")
        self.assertEqual(named("N Avenue 50 @ Library")[0], "North Av 50 @ Library")
        self.assertEqual(named("E St & 5th St")[0], "E St/5th St")

    def test_the_street_before_a_station_follows_the_street_rules_and_the_station_keeps_its_name(self):
        self.assertEqual(named("Elm Ave & Lakeside Rail Station")[0], "Elm Av & Lakeside Rail Station")
        self.assertEqual(named("La Cienega Blvd/Jefferson Blvd Station")[0], "La Cienega Blvd/Jefferson Blvd Station")

    def test_a_compass_point_before_a_numbered_street_is_spelled_out(self):
        self.assertEqual(named("N. 5th after Tropical")[0], "North 5th after Tropical")

    def test_a_lettered_avenue_keeps_its_hyphen(self):
        self.assertEqual(named("SIERRA HWY/AVE. J-7")[0], "Sierra Hwy/Av J-7")

    def test_periods_and_capitals_inside_a_joined_street_follow_the_rules(self):
        self.assertEqual(named("Grand Av/Rt. 21 (SE Corner)")[0], "Grand Av/Rt 21 (SE Corner)")
        self.assertEqual(
            named("WESTERLY AVE & ORCHARD BLVD (Orchard/Westerly Station)")[0],
            "Westerly Av/Orchard Bl (Orchard/Westerly Station)",
        )

    def test_a_hyphen_spaced_on_one_side_still_ends_the_street(self):
        self.assertEqual(
            named("Las Virgenes Road- AE Wright Middle School")[0], "Las Virgenes Rd- AE Wright Middle School"
        )


class TestShapesTheGateFound(TestCase):
    def test_an_address_abbreviates_its_compass_point(self):
        self.assertEqual(named("8330 West Elm Rd")[0], "8330 W Elm Rd")

    def test_a_hyphen_inside_a_note_does_not_split_the_street(self):
        self.assertEqual(named("W. Elm Road (Drop-Off Only)")[0], "West Elm Rd (Drop-Off Only)")

    def test_join_words_inside_a_station_name_are_lower_case(self):
        self.assertEqual(named("Lakeside Hall At Harbor Station")[0], "Lakeside Hall at Harbor Station")

    def test_a_slash_inside_a_note_does_not_split_the_name(self):
        self.assertEqual(named("Elm Road (Lakeside/Harbor Dealerships)")[0], "Elm Rd (Lakeside/Harbor Dealerships)")

    def test_a_travel_marker_before_a_second_note_still_leaves(self):
        self.assertEqual(named("Elm Av/Oak Ave (NB) (Lakeside Plaza)")[0], "Elm Av/Oak Av (Lakeside Plaza)")

    def test_a_compass_letter_after_a_house_number_loses_its_period(self):
        self.assertEqual(
            named("1389 S. Larch & Oak Av @ Lakeside Market")[0], "1389 S Larch & Oak Av @ Lakeside Market"
        )

    def test_streets_inside_any_parentheses_follow_the_street_rules(self):
        self.assertEqual(named("Elm St & Oak St (Pine Avenue)")[0], "Elm St/Oak St (Pine Av)")
        self.assertEqual(named("Lakeside Library (Elm Road) near School")[0], "Lakeside Library (Elm Rd) near School")

    def test_a_stop_with_coordinates_that_are_not_numbers_is_still_named(self):
        from tests.query_runner.test_transit_naming_streets import CROSSING, profiles

        metro = profiles(CROSSING).for_carrier("MT", "Metro")
        name = name_stop(
            {
                "stop_id": "x",
                "stop_name": "Library near Haster St",
                "lat": "NaN",
                "lng": "Infinity",
                "transit_modes": "BUS",
            },
            metro,
        )
        self.assertEqual(name.public_name, "Library near Haster St")

    def test_a_station_name_inside_parentheses_keeps_its_spelling(self):
        self.assertEqual(
            named("Elm St & Oak St (9th Street/Lakeside Center Station)")[0],
            "Elm St/Oak St (9th Street/Lakeside Center Station)",
        )

    def test_a_street_beside_a_station_in_parentheses_follows_the_rules(self):
        self.assertEqual(
            named("Elm St & Oak St (Lakeside Hall At Harbor Station)")[0],
            "Elm St/Oak St (Lakeside Hall at Harbor Station)",
        )
        self.assertEqual(
            named("Elm St & Oak St (Elm Avenue near Harbor Station)")[0], "Elm St/Oak St (Elm Av near Harbor Station)"
        )
