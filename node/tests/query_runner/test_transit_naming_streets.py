import json
from math import cos, radians
from unittest import TestCase

from redash.transit_naming.profile_loader import CORE_PROFILE_DIR, build_profile_set
from redash.transit_naming.profiles import ProfileError
from redash.transit_naming.suffixes import CarrierIndexes, build_index, name_stops
from tests.query_runner.transit_naming_fixtures import MT_YAML, mca_stop

LAT = 33.8
LNG = -117.9
KEEP = "  keep_whole: [Broadway]"
STREETS_OPTION = KEEP + '\n  split_on: ["&", "/", "-"]\n  street_reference: {within_m: 100}'
BOTH_OPTIONS = STREETS_OPTION + "\n  complete_suffixes: {same_intersection_m: 150, unique_street_m: 2000}"


def at(meters_north):
    return LAT + meters_north / 111_000.0


def east(meters):
    return LNG + meters / (111_000.0 * cos(radians(LAT)))


def point(east_m, north_m):
    return [round(east(east_m), 6), round(at(north_m), 6)]


def north_south(name, east_m, south_m=-500, north_m=500):
    return [name, [point(east_m, south_m), point(east_m, north_m)]]


def east_west(name, north_m, west_m=-800, east_m=800):
    return [name, [point(west_m, north_m), point(east_m, north_m)]]


CROSSING = [north_south("Haster Street", 5), east_west("East Orangewood Avenue", 30)]


def profiles(streets, option=STREETS_OPTION):
    files = {"MT.yaml": MT_YAML.replace(KEEP, option)}
    if streets is not None:
        files["MT.streets.json"] = json.dumps({"streets": streets})
    return build_profile_set([CORE_PROFILE_DIR], extra_files={"/pack/naming_profiles": files})


def stop(stop_id, raw, north_m=0, east_m=0):
    return mca_stop(stop_id, raw, at(north_m), east(east_m), "", "")


def complete(raw, streets, option=STREETS_OPTION, **where):
    profile = profiles(streets, option).for_carrier("MT", "Metro")
    stops = [stop("1", raw, **where)]
    return name_stops(stops, profile, build_index(stops, profile))[0]


class TestStreetReference(TestCase):
    def test_both_bare_streets_take_the_suffix_of_the_way_they_name(self):
        name = complete("HASTER-ORANGEWOOD", CROSSING)
        self.assertEqual(name.public_name, "Haster St/Orangewood Av")
        self.assertEqual(name.original_public_name, "Haster/Orangewood")
        self.assertEqual(name.suffix_completion, "street_reference")

    def test_a_stop_mid_block_between_distant_vertices_is_on_the_way(self):
        self.assertEqual(complete("HASTER-ORANGEWOOD", CROSSING, north_m=-60).public_name, "Haster St/Orangewood Av")

    def test_a_way_beyond_the_range_donates_nothing(self):
        streets = [north_south("Haster Street", 300), east_west("Orangewood Avenue", 30)]
        self.assertEqual(complete("HASTER-ORANGEWOOD", streets).public_name, "Haster/Orangewood Av")

    def test_two_suffixes_in_range_for_one_name_abstain(self):
        streets = CROSSING + [east_west("Orangewood Street", 70)]
        self.assertEqual(complete("HASTER-ORANGEWOOD", streets).public_name, "Haster St/Orangewood")

    def test_a_way_named_without_a_listed_suffix_donates_nothing(self):
        streets = [north_south("Haster", 5), east_west("Orangewood Circle", 30)]
        self.assertEqual(complete("HASTER-ORANGEWOOD", streets).public_name, "Haster/Orangewood")

    def test_a_whole_name_stays_whole(self):
        streets = [north_south("El Camino Real", 5), east_west("Orangewood Avenue", 30)]
        self.assertEqual(complete("EL CAMINO REAL-ORANGEWOOD", streets).public_name, "El Camino Real/Orangewood Av")

    def test_a_leading_direction_word_is_not_part_of_the_name(self):
        streets = [north_south("North Haster Street", 5), east_west("West 17th Street", 30)]
        self.assertEqual(complete("HASTER-17TH", streets).public_name, "Haster St/17th St")

    def test_a_street_named_for_a_direction_keeps_that_word(self):
        streets = [north_south("South Coast Drive", 5), east_west("Orangewood Avenue", 30)]
        self.assertEqual(complete("SOUTH COAST-ORANGEWOOD", streets).public_name, "South Coast Dr/Orangewood Av")

    def test_the_reference_is_tried_before_the_stop_donors(self):
        stops = [stop("1", "HASTER-ORANGEWOOD"), stop("2", "Haster Way-Orangewood Avenue", north_m=20)]
        profile = profiles(CROSSING, BOTH_OPTIONS).for_carrier("MT", "Metro")
        name = name_stops(stops, profile, build_index(stops, profile))[0]
        self.assertEqual((name.public_name, name.suffix_completion), ("Haster St/Orangewood Av", "street_reference"))

    def test_the_stop_donors_fill_what_the_reference_cannot(self):
        stops = [stop("1", "HASTER-ORANGEWOOD"), stop("2", "Haster Way-Orangewood Avenue", north_m=20)]
        profile = profiles([east_west("Orangewood Avenue", 30)], BOTH_OPTIONS).for_carrier("MT", "Metro")
        name = name_stops(stops, profile, build_index(stops, profile))[0]
        self.assertEqual(name.public_name, "Haster Way/Orangewood Av")

    def test_a_reference_alone_needs_no_stop_load(self):
        profile = profiles(CROSSING).for_carrier("MT", "Metro")

        def refuse(carrier):
            raise AssertionError("loaded the carrier's stops")

        name = CarrierIndexes("rev", None, refuse).name(stop("1", "HASTER-ORANGEWOOD"), profile)
        self.assertEqual(name.public_name, "Haster St/Orangewood Av")


class TestStreetReferenceFile(TestCase):
    def refused(self, streets, option=STREETS_OPTION, raw=None):
        files = {"MT.yaml": MT_YAML.replace(KEEP, option)}
        if raw is not None:
            files["MT.streets.json"] = raw
        elif streets is not None:
            files["MT.streets.json"] = json.dumps({"streets": streets})
        with self.assertRaises(ProfileError) as raised:
            build_profile_set([CORE_PROFILE_DIR], extra_files={"/pack/naming_profiles": files})
        return raised.exception

    def test_the_option_without_its_file_is_refused(self):
        self.assertEqual(self.refused(None).field, "stop_name.street_reference")

    def test_a_malformed_file_is_refused(self):
        self.assertIn("MT.streets.json", str(self.refused(None, raw="not json")))
        self.assertIn("MT.streets.json", str(self.refused([["Haster Street", [[1, 2]]]])))
        self.assertIn("MT.streets.json", str(self.refused([["", [[1, 2], [3, 4]]]])))
        self.assertIn("MT.streets.json", str(self.refused([["Haster Street", [[1, "2"], [3, 4]]]])))

    def test_a_non_positive_range_is_refused(self):
        option = STREETS_OPTION.replace("within_m: 100", "within_m: 0")
        self.assertEqual(self.refused(CROSSING, option).field, "stop_name.street_reference.within_m")

    def test_an_unknown_key_is_refused(self):
        option = STREETS_OPTION.replace("within_m: 100", "radius_m: 100")
        self.assertIn("radius_m", str(self.refused(CROSSING, option)))

    def test_a_file_without_the_option_completes_nothing(self):
        name = complete("HASTER-ORANGEWOOD", CROSSING, KEEP + '\n  split_on: ["&", "/", "-"]')
        self.assertEqual((name.public_name, name.suffix_completion), ("Haster/Orangewood", ""))

    def test_the_revision_moves_with_the_file(self):
        first = profiles(CROSSING).revision
        second = profiles(CROSSING + [east_west("Orangewood Street", 70)]).revision
        self.assertNotEqual(first, second)
