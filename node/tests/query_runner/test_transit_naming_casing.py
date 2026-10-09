import tempfile
from dataclasses import replace
from unittest import TestCase

from redash.transit_naming import provenance
from redash.transit_naming.gtfs_shapes import path_rows
from redash.transit_naming.profile_loader import CORE_PROFILE_DIR, load_profiles
from redash.transit_naming.profiles import CORE_REVISION, ProfileError
from redash.transit_naming.routes import name_route
from redash.transit_naming.snapshot import GtfsSnapshot, ResolvedRoute
from redash.transit_naming.stops import name_stop, raw_street_parts
from tests.query_runner.transit_naming_fixtures import (
    MT_ROUTES,
    MT_YAML,
    metro_profile,
    write_profile_dir,
)

METRO = metro_profile(with_overrides=False)
OCTA = replace(
    METRO,
    carrier_code="OC",
    stop_name=replace(METRO.stop_name, split_on=("&", "/", "\\", "-"), keep_upper=frozenset({"ARTIC", "UCI"})),
)
ROUTES = {r["route_code"]: r for r in MT_ROUTES}


def stop(name, modes="BUS", on="", cross=""):
    return {
        "stop_id": "x",
        "stop_name": name,
        "on_street": on,
        "cross_street": cross,
        "street_direction": "",
        "transit_modes": modes,
        "prediction_count": 1,
    }


def public(name, profile=OCTA, **kwargs):
    return name_stop(stop(name, **kwargs), profile).public_name


class TestUppercaseNamesAreRecased(TestCase):
    def test_an_uppercase_hyphen_pair_is_an_intersection_in_title_case(self):
        name = name_stop(stop("PACIFIC COAST-1ST"), OCTA)
        self.assertEqual((name.public_name, name.stop_kind), ("Pacific Coast/1st", "intersection"))
        self.assertEqual((name.on_street, name.cross_street), ("Pacific Coast", "1st"))
        self.assertEqual(name.public_name_source, provenance.RULE)

    def test_ordinals_keep_their_letters_lowercase(self):
        self.assertEqual(public("17TH-183RD"), "17th/183rd")

    def test_spanish_articles_lead_a_street_capitalized_and_sit_inside_it_lowercase(self):
        self.assertEqual(public("LA HABRA-FONDA"), "La Habra/Fonda")
        self.assertEqual(public("MARGUERITE-CASTA DEL SOL"), "Marguerite/Casta del Sol")
        self.assertEqual(public("CAMINO DE LOS MARES-EL CAMINO REAL"), "Camino de los Mares/El Camino Real")

    def test_mc_names_capitalize_the_letter_after_mc(self):
        self.assertEqual(public("MCFADDEN-PRODUCT"), "McFadden/Product")

    def test_listed_acronyms_and_single_letters_stay_uppercase(self):
        self.assertEqual(public("KATELLA-ARTIC"), "Katella/ARTIC")
        self.assertEqual(public("CAMPUS-UCI"), "Campus/UCI")
        self.assertEqual(public("AVENUE B-MAIN"), "Av B/Main")

    def test_suffix_words_are_abbreviated_after_recasing(self):
        self.assertEqual(public("BEACH-AUTO CENTER DRIVE"), "Beach/Auto Center Dr")

    def test_an_uppercase_named_place_is_recased_and_keeps_its_wording(self):
        name = name_stop(stop("FULLERTON PARK AND RIDE DOCK 6"), OCTA)
        self.assertEqual((name.public_name, name.stop_kind), ("Fullerton Park and Ride Dock 6", "named_place"))

    def test_uppercase_street_parts_are_recased_with_an_uppercase_name(self):
        name = name_stop(stop("MAIN/OAK", on="MAIN STREET", cross="OAK AVENUE"), OCTA)
        self.assertEqual(name.public_name, "Main St/Oak Av")

    def test_an_uppercase_street_part_inside_a_mixed_case_name_keeps_its_capitals(self):
        name = name_stop(stop("Temple City Bl/RR XING", on="Temple City Bl", cross="RR XING"), METRO)
        self.assertEqual(name.public_name, "Temple City Bl/RR XING")


class TestMixedCaseNamesKeepTheirCapitals(TestCase):
    def test_a_lowercase_initial_leading_a_street_is_capitalized(self):
        self.assertEqual(public("del Mar Blvd/Allen Ave", METRO), "Del Mar Bl/Allen Av")

    def test_articles_inside_a_street_stay_lowercase(self):
        self.assertEqual(public("Avenida de la Estrella/Calle Agua", METRO), "Avenida de la Estrella/Calle Agua")
        self.assertEqual(public("SM Villa Gold Ln STA/Bay 4 or 5", METRO), "SM Villa Gold Ln STA/Bay 4 or 5")
        self.assertEqual(public("Villa St between Maple Way/Lake Av", METRO), "Villa St between Maple Way/Lake Av")
        self.assertEqual(public("6th \\ Private Right-of-Way", METRO), "6th/Private Right-of-Way")

    def test_acronyms_in_a_mixed_case_name_are_left_alone(self):
        self.assertEqual(public("Figueroa/USC", METRO), "Figueroa/USC")
        self.assertEqual(public("LAX City Bus Center", METRO), "LAX City Bus Center")


class TestCasingReviewFindings(TestCase):
    def test_accented_letters_stay_inside_their_words(self):
        self.assertEqual(public("César Chávez/Main Street", METRO), "César Chávez/Main St")
        self.assertEqual(public("CÉSAR CHÁVEZ-MAIN"), "César Chávez/Main")

    def test_a_profile_separator_starts_a_street_in_a_mixed_case_name(self):
        self.assertEqual(public("Main-del Mar"), "Main/Del Mar")

    def test_any_configured_separator_starts_a_street_in_an_uppercase_name(self):
        piped = replace(OCTA, stop_name=replace(OCTA.stop_name, split_on=("|",)))
        self.assertEqual(public("MAIN|DEL MAR", piped), "Main/Del Mar")


class TestSplitOnIsPerProfile(TestCase):
    def test_metro_does_not_split_on_a_hyphen(self):
        self.assertEqual(public("Elmwood - Western", METRO), "Elmwood - Western")

    def test_a_profile_that_lists_the_hyphen_splits_on_it(self):
        self.assertEqual(public("Elmwood - Western", OCTA), "Elmwood/Western")

    def test_suffix_donor_parts_split_the_same_way(self):
        self.assertEqual(raw_street_parts(stop("ORANGE-MAIN STREET"), OCTA.stop_name), ["Orange", "Main St"])
        self.assertEqual(raw_street_parts(stop("Elmwood - Western"), METRO.stop_name), ["Elmwood - Western"])


class TestTrailingBoundTokens(TestCase):
    def test_a_trailing_bound_abbreviation_becomes_the_direction(self):
        name = name_stop(stop("Potrero Grande/Markland SB"), METRO)
        self.assertEqual((name.public_name, name.direction), ("Potrero Grande/Markland", "Southbound"))

    def test_a_street_named_like_a_bound_word_is_untouched(self):
        self.assertEqual(public("Main/NB Plaza Dr", METRO), "Main/NB Plaza Dr")


class TestRouteLongNames(TestCase):
    def resolved(self, long_name):
        return ResolvedRoute("30-13201", "30", long_name, "3", "", "", "bus", provenance.GTFS, "digest")

    def test_long_names_take_the_stop_suffixes_and_casing(self):
        name = name_route(ROUTES["MT030"], METRO, self.resolved("Santa Ana / Costa mesa"))
        self.assertEqual(name.long_name, "Santa Ana / Costa Mesa")
        name = name_route(ROUTES["MT030"], METRO, self.resolved("10 Whittier Blvd"))
        self.assertEqual(name.long_name, "10 Whittier Bl")

    def test_uppercase_long_names_are_recased(self):
        name = name_route(ROUTES["MT030"], OCTA, self.resolved("LA HABRA - FOUNTAIN VALLEY"))
        self.assertEqual(name.long_name, "La Habra - Fountain Valley")

    def test_abbreviations_with_periods_survive(self):
        name = name_route(ROUTES["MT030"], METRO, self.resolved("So. Raymond - Linda Vista - JPL"))
        self.assertEqual(name.long_name, "So. Raymond - Linda Vista - JPL")


class TestPathHeadsigns(TestCase):
    def test_path_headsigns_use_the_headsign_rules(self):
        trip = {"route_id": "R", "trip_id": "a", "direction_id": "0", "shape_id": "", "trip_headsign": "BREA MALL"}
        snapshot = GtfsSnapshot("bus", "digest", {"R": {}}, (trip,), {"a": [(1, "1"), (2, "2")]}, {})
        rows = path_rows("OC", "OC143", "R", snapshot, OCTA, "digest")
        self.assertEqual([row["headsign"] for row in rows], ["Brea Mall"])


class TestProfileOptions(TestCase):
    KEEP = "  keep_whole: [Broadway]"

    def load(self, option):
        text = MT_YAML.replace(self.KEEP, self.KEEP + "\n" + option) if option else MT_YAML
        with tempfile.TemporaryDirectory() as pack:
            write_profile_dir(pack, {"MT.yaml": text})
            return load_profiles([CORE_PROFILE_DIR, pack]).profiles["MT"].stop_name

    def refused(self, option):
        with self.assertRaises(ProfileError) as raised:
            self.load(option)
        return str(raised.exception)

    def test_defaults(self):
        rules = self.load("")
        self.assertEqual((rules.split_on, rules.keep_upper), (("&", "/", "\\"), frozenset()))

    def test_both_are_read(self):
        rules = self.load('  split_on: ["&", "/", "-"]\n  keep_upper: [ARTIC, uci]')
        self.assertEqual((rules.split_on, rules.keep_upper), (("&", "/", "-"), frozenset({"ARTIC", "UCI"})))

    def test_split_on_must_be_single_non_alphanumeric_characters(self):
        self.assertIn("split_on", self.refused("  split_on: []"))
        self.assertIn("split_on", self.refused('  split_on: ["and"]'))
        self.assertIn("split_on", self.refused('  split_on: ["a"]'))
        self.assertIn("split_on", self.refused('  split_on: "/"'))

    def test_the_revision_moved_with_the_casing_rules(self):
        self.assertEqual(CORE_REVISION, "2026.10.09.2")
