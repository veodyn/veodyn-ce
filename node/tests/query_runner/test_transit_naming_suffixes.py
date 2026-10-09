from math import cos, radians
from unittest import TestCase

from redash.transit_naming import provenance
from redash.transit_naming.profile_loader import CORE_PROFILE_DIR, build_profile_set
from redash.transit_naming.stops import name_stop, stop_row
from redash.transit_naming.suffixes import build_index, donor_entries, name_stops
from tests.query_runner.transit_naming_fixtures import (
    MT_STOPS,
    MT_YAML,
    mca_stop,
    metro_suffix_profiles,
)

PROFILE = metro_suffix_profiles().for_carrier("MT", "Metro")

LAT = 34.0
LNG = -118.3


def at(meters_north):
    return LAT + meters_north / 111_000.0


def east(meters):
    return LNG + meters / (111_000.0 * cos(radians(LAT)))


def stop(stop_id, raw, meters_north, on="", cross="", east_m=0, **kwargs):
    return mca_stop(stop_id, raw, at(meters_north), east(east_m), on, cross, **kwargs)


def named(stops):
    index = build_index(stops, PROFILE)
    return {s["stop_id"]: name for s, name in zip(stops, name_stops(stops, PROFILE, index))}


class TestDonors(TestCase):
    def entries(self, *stops):
        return donor_entries(list(stops), PROFILE)

    def test_a_suffixed_part_of_a_live_intersection_is_a_donor(self):
        entries = self.entries(stop("a", "Elmwood/10th", 0, "Elmwood Blvd", "10th St"))
        self.assertEqual([(e[0], e[1], e[2], e[3]) for e in entries], [("elmwood", "10th", "Bl", "St")])

    def test_a_suffix_that_is_not_the_last_word_is_not_a_donor(self):
        entries = self.entries(stop("a", "Valley Bl Heights/Main St", 0))
        self.assertEqual([(e[0], e[2], e[3]) for e in entries], [("valley bl heights", "", "St")])

    def test_two_suffixes_in_one_part_is_not_a_donor(self):
        entries = self.entries(stop("a", "Ocean Av St/Main St", 0))
        self.assertEqual([(e[2], e[3]) for e in entries], [("", "St")])

    def test_a_part_ending_in_a_direction_word_is_not_a_donor(self):
        entries = self.entries(stop("a", "Ocean St North/Main St", 0))
        self.assertEqual([(e[2], e[3]) for e in entries], [("", "St")])

    def test_a_base_that_does_not_match_the_raw_name_is_not_a_donor(self):
        loose = stop("a", "Main/Valley", 0, "Main St", "Valley Circle Blvd")
        self.assertEqual(name_stop(loose, PROFILE).public_name, "Main St/Valley Circle Bl")
        self.assertEqual(self.entries(loose), [])

    def test_a_loosely_accepted_stop_does_not_donate_through_its_good_part(self):
        stops = [
            stop("a", "Main/Valley", 0, "Main St", "Valley Circle Blvd"),
            stop("b", "Main/Elm", 4000, "Main Ave", "Elm Ave"),
            stop("c", "Main/Valley Circle", 50, "Main", "Valley Circle"),
        ]
        result = named(stops)["c"]
        self.assertEqual((result.public_name, result.suffix_completion), ("Main/Valley Circle", ""))

    def test_a_stop_whose_parts_do_not_map_one_to_one_onto_its_raw_name_donates_nothing(self):
        self.assertEqual(self.entries(stop("a", "Main/Elm", 0, "Main St", "Main Ave")), [])
        self.assertEqual(self.entries(stop("b", "Main/Elm", 0, "Main St", "Pine Ave")), [])

    def test_two_parts_claiming_one_raw_part_are_both_refused(self):
        entries = self.entries(stop("a", "Main/Elm", 0, "Main St", "Main Ave"))
        self.assertEqual(entries, [])

    def test_an_override_named_stop_is_not_a_donor(self):
        entries = self.entries(stop("3000001", "Pico/Rimpau", 0, "Pico Blvd", "Rimpau Blvd"))
        self.assertEqual(entries, [])

    def test_a_retired_stop_is_not_a_donor(self):
        entries = self.entries(stop("a", "Elmwood/10th", 0, "Elmwood Blvd", "10th St", modes="", predictions=0))
        self.assertEqual(entries, [])

    def test_stations_places_unparsed_and_coordinate_less_stops_are_not_donors(self):
        no_coordinates = dict(stop("e", "Elmwood/10th", 0, "Elmwood Blvd", "10th St"), lat=None, lng=None)
        entries = self.entries(
            stop("b", "Pacific Ave Station", 0, "Pacific Avenue", "4th Street", modes="RAIL"),
            stop("c", "Fullerton Park & Ride Dock 14", 0),
            stop("d", "Somewhere Blvd", 0),
            no_coordinates,
        )
        self.assertEqual(entries, [])

    def test_completed_names_never_feed_back(self):
        stops = [
            stop("a", "Elmwood/10th", 0, "Elmwood Blvd", "10th St"),
            stop("b", "Elmwood/10th", 100, "Elmwood", "10th"),
            stop("c", "Elmwood/Cross", 2500, "Elmwood", "Cross"),
        ]
        self.assertEqual(len(build_index(stops, PROFILE).entries), 1)
        self.assertEqual(named(stops)["b"].public_name, "Elmwood Bl/10th St")
        self.assertEqual(named(stops)["c"].public_name, "Elmwood/Cross")


class TestRules(TestCase):
    def test_same_intersection_fills_both_bare_parts(self):
        result = named(
            [
                stop("a", "Elmwood/10th", 0, "Elmwood Blvd", "10th St"),
                stop("b", "Elmwood/10th", 100, "Elmwood", "10th"),
            ]
        )["b"]
        self.assertEqual(result.public_name, "Elmwood Bl/10th St")
        self.assertEqual((result.on_street, result.cross_street), ("Elmwood Bl", "10th St"))
        self.assertEqual(result.original_public_name, "Elmwood/10th")
        self.assertEqual(result.suffix_completion, "same_intersection")
        self.assertEqual(result.public_name_source, provenance.RULE)

    def test_same_intersection_conflict_abstains_for_that_base(self):
        result = named(
            [
                stop("a", "Elmwood/10th", 0, "Elmwood Blvd", "10th St"),
                stop("b", "Elmwood/10th", 50, "Elmwood Ave", "10th St"),
                stop("c", "Elmwood/10th", 100, "Elmwood", "10th"),
            ]
        )["c"]
        self.assertEqual(result.public_name, "Elmwood/10th St")

    def test_the_same_intersection_must_be_within_range(self):
        result = named(
            [
                stop("a", "Elmwood/10th", 0, "Elmwood Blvd", "10th St"),
                stop("b", "Elmwood/10th", 180, "Elmwood", "10th"),
            ]
        )["b"]
        self.assertEqual(result.suffix_completion, "unique_street")

    def test_unique_street_fills_within_range(self):
        result = named(
            [
                stop("a", "Hoover/Adams", 0, "Hoover St", "Adams"),
                stop("b", "Hoover/Jefferson", 1900, "Hoover", "Jefferson"),
            ]
        )["b"]
        self.assertEqual(result.public_name, "Hoover St/Jefferson")
        self.assertEqual(result.suffix_completion, "unique_street")

    def test_unique_street_out_of_range_abstains(self):
        result = named(
            [
                stop("a", "Hoover/Adams", 0, "Hoover St", "Adams"),
                stop("b", "Hoover/Jefferson", 2100, "Hoover", "Jefferson"),
            ]
        )["b"]
        self.assertEqual((result.public_name, result.suffix_completion), ("Hoover/Jefferson", ""))

    def test_unique_street_with_several_suffixes_abstains(self):
        result = named(
            [
                stop("a", "Alameda/Adams", 0, "Alameda St", "Adams"),
                stop("b", "Alameda/Slauson", 3000, "Alameda Ave", "Slauson"),
                stop("c", "Alameda/Jefferson", 500, "Alameda", "Jefferson"),
            ]
        )["c"]
        self.assertEqual((result.public_name, result.suffix_completion), ("Alameda/Jefferson", ""))

    def test_rules_are_checked_in_order(self):
        result = named(
            [
                stop("a", "Alameda/Adams", 0, "Alameda St", "Adams"),
                stop("b", "Alameda/Slauson", 9000, "Alameda Ave", "Slauson"),
                stop("c", "Alameda/Adams", 100, "Alameda", "Adams"),
            ]
        )["c"]
        self.assertEqual((result.public_name, result.suffix_completion), ("Alameda St/Adams", "same_intersection"))

    def test_untouched_kinds_keep_todays_name(self):
        donor = stop("a", "Elmwood/10th", 0, "Elmwood Blvd", "10th St")
        untouched = [
            stop("b", "Pacific Ave Station", 10, "Pacific Avenue", "4th Street", modes="RAIL"),
            stop("c", "Fullerton Park & Ride Dock 14", 10),
            stop("d", "Elmwood Plaza Lot", 10),
            dict(stop("e", "Elmwood/10th", 10, "Elmwood", "10th"), lat=None, lng=None),
            stop("f", "Elmwood/10th", 10, "Elmwood", "10th", modes="", predictions=0),
        ]
        result = named([donor] + untouched)
        for item in untouched:
            expected = name_stop(item, PROFILE)
            self.assertEqual(result[item["stop_id"]].public_name, expected.public_name)
            self.assertEqual(result[item["stop_id"]].suffix_completion, "")

    def test_an_override_named_stop_keeps_its_override(self):
        result = named(
            [
                stop("a", "Pico/Rimpau", 0, "Pico Blvd", "Rimpau Blvd"),
                stop("3000001", "Pico \\ Rimpau", 10),
            ]
        )["3000001"]
        self.assertEqual((result.public_name, result.public_name_source), ("Pico/Rimpau", provenance.OVERRIDE))
        self.assertEqual(result.suffix_completion, "")

    def test_keep_whole_and_direction_word_parts_stay_bare_though_a_donor_carries_a_suffix(self):
        result = named(
            [
                stop("a", "Broadway St/Main", 0, "Broadway St", "Main St"),
                stop("b", "Ocean North St/Main", 0, "Ocean North St", "Main St"),
                stop("c", "Broadway/Main", 10, "Broadway", "Main"),
                stop("d", "Ocean North/Main", 10, "Ocean North", "Main"),
                stop("e", "Broadway/Elm", 800, "Broadway", "Elm"),
                stop("f", "Ocean North/Elm", 800, "Ocean North", "Elm"),
            ]
        )
        self.assertEqual(result["a"].public_name, "Broadway St/Main St")
        self.assertEqual(result["c"].public_name, "Broadway/Main St")
        self.assertEqual(result["d"].public_name, "Ocean North/Main St")
        self.assertEqual(result["e"].public_name, "Broadway/Elm")
        self.assertEqual(result["f"].public_name, "Ocean North/Elm")

    def test_a_carrier_without_the_option_completes_nothing(self):
        plain = build_profile_set(
            [CORE_PROFILE_DIR], extra_files={"/pack/naming_profiles": {"MT.yaml": MT_YAML}}
        ).for_carrier("MT", "Metro")
        stops = [
            stop("a", "Elmwood/10th", 0, "Elmwood Blvd", "10th St"),
            stop("b", "Elmwood/10th", 100, "Elmwood", "10th"),
        ]
        results = name_stops(stops, plain, build_index(stops, plain))
        self.assertEqual([r.public_name for r in results], ["Elmwood Bl/10th St", "Elmwood/10th"])
        self.assertEqual([r.suffix_completion for r in results], ["", ""])


class TestDistance(TestCase):
    def fill(self, east_m, north_m=0):
        donor = stop("a", "Elmwood/10th", 0, "Elmwood Blvd", "10th St")
        target = stop("b", "Elmwood/10th", north_m, "Elmwood", "10th", east_m=east_m)
        return named([donor, target])["b"].suffix_completion

    def test_east_west_distance_counts_toward_the_same_intersection_range(self):
        self.assertEqual(self.fill(120), "same_intersection")
        self.assertEqual(self.fill(180), "unique_street")

    def test_east_west_distance_counts_toward_the_unique_street_range(self):
        donor = stop("a", "Hoover/Adams", 0, "Hoover St", "Adams")
        near = stop("b", "Hoover/Jefferson", 0, "Hoover", "Jefferson", east_m=1900)
        far = stop("c", "Hoover/Jefferson", 0, "Hoover", "Jefferson", east_m=2100)
        result = named([donor, near, far])
        self.assertEqual(result["b"].public_name, "Hoover St/Jefferson")
        self.assertEqual(result["c"].public_name, "Hoover/Jefferson")

    def test_diagonal_distance_combines_both_axes(self):
        self.assertEqual(self.fill(110, north_m=110), "unique_street")


class TestCoordinates(TestCase):
    BAD = [
        (float("nan"), -118.3),
        (34.0, float("nan")),
        (float("inf"), -118.3),
        (34.0, float("-inf")),
        (91.0, -118.3),
        (-91.0, -118.3),
        (34.0, 181.0),
        (34.0, -181.0),
    ]

    def test_a_recipient_without_finite_in_range_coordinates_abstains(self):
        donor = stop("a", "Hoover/Adams", 0, "Hoover St", "Adams")
        for lat, lng in self.BAD:
            target = mca_stop("b", "Hoover/Jefferson", lat, lng, "Hoover", "Jefferson")
            result = named([donor, target])["b"]
            self.assertEqual((result.public_name, result.suffix_completion), ("Hoover/Jefferson", ""), (lat, lng))

    def test_a_donor_without_finite_in_range_coordinates_donates_nothing(self):
        for lat, lng in self.BAD:
            donor = mca_stop("a", "Hoover/Adams", lat, lng, "Hoover St", "Adams")
            target = stop("b", "Hoover/Jefferson", 0, "Hoover", "Jefferson")
            self.assertEqual(donor_entries([donor], PROFILE), [], (lat, lng))
            self.assertEqual(named([donor, target])["b"].public_name, "Hoover/Jefferson", (lat, lng))


class TestRows(TestCase):
    def test_rows_carry_the_original_name_and_the_completion_method(self):
        stops = [
            stop("a", "Elmwood/10th", 0, "Elmwood Blvd", "10th St"),
            stop("b", "Elmwood/10th", 100, "Elmwood", "10th"),
        ]
        results = named(stops)
        row = stop_row(stops[1], results["b"], "rev", "digest")
        self.assertEqual(
            (row["public_name"], row["original_public_name"], row["suffix_completion"]),
            ("Elmwood Bl/10th St", "Elmwood/10th", "same_intersection"),
        )
        plain = stop_row(stops[0], results["a"], "rev", "digest")
        self.assertEqual((plain["original_public_name"], plain["suffix_completion"]), ("Elmwood Bl/10th St", ""))

    def test_the_shared_fixture_stops_are_unchanged_by_completion(self):
        for item, result in zip(MT_STOPS, name_stops(MT_STOPS, PROFILE, build_index(MT_STOPS, PROFILE))):
            self.assertEqual(result.original_public_name or result.public_name, name_stop(item, PROFILE).public_name)
