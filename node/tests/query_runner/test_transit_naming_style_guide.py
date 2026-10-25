from unittest import TestCase

from redash.transit_naming.profile_loader import CORE_PROFILE_DIR, build_profile_set
from redash.transit_naming.stops import name_stop, normalize_part
from redash.transit_naming.suffixes import classify
from tests.query_runner.transit_naming_fixtures import metro_profile

PROFILE = metro_profile(with_overrides=False)


def stop(name, modes="BUS", on="", cross="", street_direction=""):
    return {
        "stop_id": "x",
        "stop_name": name,
        "on_street": on,
        "cross_street": cross,
        "street_direction": street_direction,
        "transit_modes": modes,
        "prediction_count": 1,
    }


def public(name, **kwargs):
    return name_stop(stop(name, **kwargs), PROFILE).public_name


class TestIntersectionsUseATightSlash(TestCase):
    def test_a_station_named_by_an_intersection(self):
        self.assertEqual(public("7th Street / Metro Center Station", modes="RAIL"), "7th Street/Metro Center Station")
        self.assertEqual(public("Elmwood / Oak Park Station", modes="RAIL"), "Elmwood/Oak Park Station")

    def test_a_station_keeps_street_spelled_out(self):
        self.assertEqual(
            public("103rd Street / Watts Towers Station", modes="RAIL"), "103rd Street/Watts Towers Station"
        )

    def test_a_named_place_and_an_unparsed_name(self):
        self.assertEqual(public("Pico Terminal - Jackson / Passons"), "Pico Terminal - Jackson/Passons")
        self.assertEqual(public("Harbor Transitway / 37th St / USC"), "Harbor Transitway/37th St/USC")


class TestPlaceWordsMatchWholeWords(TestCase):
    def test_a_street_containing_a_place_word_is_an_intersection(self):
        for raw, expected in {
            "Centinela / Braddock": "Centinela/Braddock",
            "La Brea / Dockweiler": "La Brea/Dockweiler",
        }.items():
            name = name_stop(stop(raw), PROFILE)
            self.assertEqual((name.public_name, name.stop_kind), (expected, "intersection"), raw)

    def test_a_real_place_word_still_makes_a_named_place(self):
        name = name_stop(stop("6th / Oxford Terminal"), PROFILE)
        self.assertEqual(name.stop_kind, "named_place")


class TestStreetDesignationsAbbreviateOnlyInSuffixPosition(TestCase):
    def test_a_designation_used_in_a_phrase_is_written_out(self):
        rules = PROFILE.stop_name
        self.assertEqual(normalize_part("Avenue of the Stars", rules), "Avenue of the Stars")
        self.assertEqual(normalize_part("Avenue San Luis", rules), "Avenue San Luis")
        self.assertEqual(normalize_part("Court St", rules), "Court St")

    def test_numbered_and_lettered_avenues_abbreviate(self):
        rules = PROFILE.stop_name
        self.assertEqual(normalize_part("Avenue 26", rules), "Av 26")
        self.assertEqual(normalize_part("Ave. Q-8", rules), "Av Q-8")
        self.assertEqual(normalize_part("Ave R", rules), "Av R")
        self.assertEqual(normalize_part("Hwy 74", rules), "Hwy 74")

    def test_the_suffix_before_a_trailing_compass_word_abbreviates(self):
        rules = PROFILE.stop_name
        self.assertEqual(normalize_part("Palos Verdes Drive N", rules), "Palos Verdes Dr N")
        self.assertEqual(normalize_part("10th Street West", rules), "10th St West")

    def test_an_intersection_with_a_phrase_street(self):
        self.assertEqual(public("Santa Monica Blvd/Avenue of the Stars"), "Santa Monica Bl/Avenue of the Stars")


class TestParkAndRide(TestCase):
    def test_every_spelling_becomes_park_and_ride_with_an_ampersand(self):
        for raw, expected in {
            "Harbor Beacon Park and Ride": "Harbor Beacon Park & Ride",
            "Fairplex Park n Ride": "Fairplex Park & Ride",
            "Montclair Park-N-Ride": "Montclair Park & Ride",
            "FULLERTON PARK AND RIDE DOCK 5": "Fullerton Park & Ride Dock 5",
        }.items():
            name = name_stop(stop(raw), PROFILE)
            self.assertEqual((name.public_name, name.stop_kind), (expected, "named_place"), raw)

    def test_a_street_named_park_is_left_alone(self):
        self.assertEqual(public("Park Av/Ride St"), "Park Av/Ride St")
        self.assertEqual(public("Park/Ride St"), "Park/Ride St")


class TestDirectionIsATravelDirection(TestCase):
    def test_the_vendor_street_direction_becomes_a_bound_word(self):
        name = name_stop(stop("1st St/Main St", street_direction="East"), PROFILE)
        self.assertEqual(name.direction, "Eastbound")

    def test_abbreviated_bound_markers_leave_the_name(self):
        for raw, expected in {
            "Harbor St & Commerce Way (WB)": ("Harbor St/Commerce Way", "Westbound"),
            "Erbes Rd/Avenida de las Flores (N/B)": ("Erbes Rd/Avenida de las Flores", "Northbound"),
            "Residence Inn (NB Direction)": ("Residence Inn", "Northbound"),
            "Market Place (Southbound)": ("Market Place", "Southbound"),
            "Olive/Victory SB": ("Olive/Victory", "Southbound"),
        }.items():
            name = name_stop(stop(raw), PROFILE)
            self.assertEqual((name.public_name, name.direction), expected, raw)


class TestVendorStreetCasing(TestCase):
    def test_an_uppercase_vendor_word_in_a_mixed_case_name_is_recased(self):
        name = name_stop(stop("La Cienega Blvd/Obama Blvd", on="La Cienega Blvd", cross="OBAMA Blvd"), PROFILE)
        self.assertEqual(name.public_name, "La Cienega Bl/Obama Bl")
        name = name_stop(stop("Kavenaugh Ln & Hemingway Ave", on="KAVENAUGH Ln", cross="Hemingway Ave"), PROFILE)
        self.assertEqual(name.public_name, "Kavenaugh Ln/Hemingway Av")

    def test_a_word_uppercase_in_the_raw_name_stays_uppercase(self):
        name = name_stop(stop("Temple City Bl/RR XING", on="Temple City Bl", cross="RR XING"), PROFILE)
        self.assertEqual(name.public_name, "Temple City Bl/RR XING")


class TestBusStopsAreNotStations(TestCase):
    def test_a_rail_carrier_bus_stop_gets_no_station_suffix(self):
        self.assertEqual(public("Westwood UCLA Amtrak Bus Stop", modes="RAIL"), "Westwood UCLA Amtrak Bus Stop")

    def test_a_rail_stop_without_the_word_still_gets_it(self):
        self.assertEqual(public("Central", modes="RAIL"), "Central Station")


class TestCircleTerraceAndWayAreSpelledOut(TestCase):
    def test_in_the_default_profile_and_the_metro_fixture(self):
        default = build_profile_set([CORE_PROFILE_DIR]).default.stop_name
        for rules in (default, PROFILE.stop_name):
            self.assertEqual(normalize_part("Raintree Cir", rules), "Raintree Circle")
            self.assertEqual(normalize_part("Uplander Wy.", rules), "Uplander Way")
            self.assertEqual(normalize_part("Ocean Terr", rules), "Ocean Terrace")

    def test_a_spelled_out_word_is_not_a_suffix_for_completion(self):
        self.assertEqual(classify("City Terrace", PROFILE.stop_name)[0], "bare")
        self.assertEqual(classify("Golden Circle", PROFILE.stop_name)[0], "bare")
