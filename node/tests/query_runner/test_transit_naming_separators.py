from dataclasses import replace
from unittest import TestCase

from redash.transit_naming.locations import _curated
from redash.transit_naming.profile_loader import (
    CORE_PROFILE_DIR,
    build_profile_set,
    parse_profile_yaml,
)
from redash.transit_naming.profiles import ProfileError
from redash.transit_naming.stops import name_stop
from tests.query_runner.transit_naming_fixtures import metro_profile

METRO = metro_profile(with_overrides=False)


def with_rules(**changes):
    return replace(METRO, stop_name=replace(METRO.stop_name, **changes))


def stop(name):
    return {
        "stop_id": "x",
        "stop_name": name,
        "on_street": "",
        "cross_street": "",
        "street_direction": "",
        "transit_modes": "BUS",
        "prediction_count": 1,
    }


def named(raw, profile):
    name = name_stop(stop(raw), profile)
    return name.public_name, name.stop_kind


def profile_set(text, carrier):
    return build_profile_set([CORE_PROFILE_DIR], extra_files={"/pack": {f"{carrier}.yaml": text}})


class TestWordSeparators(TestCase):
    def test_a_profile_word_separator_joins_two_streets(self):
        joined_by_and = with_rules(split_words=("and",))
        self.assertEqual(
            named("Highland Ave and Huntington Dr", joined_by_and), ("Highland Av/Huntington Dr", "intersection")
        )
        self.assertEqual(named("Azusa and Puente", joined_by_and), ("Azusa/Puente", "intersection"))
        joined_by_at = with_rules(split_words=("at",))
        self.assertEqual(named("Cook at Merle", joined_by_at), ("Cook/Merle", "intersection"))

    def test_without_the_word_a_street_named_with_and_is_left_alone(self):
        self.assertEqual(named("Bellflower/Stewart and Gray", METRO), ("Bellflower/Stewart and Gray", "intersection"))

    def test_a_word_separator_inside_a_word_does_not_split(self):
        joined_by_at = with_rules(split_words=("at",))
        self.assertEqual(named("Atlantic/Batavia", joined_by_at), ("Atlantic/Batavia", "intersection"))

    def test_punctuation_separators_come_from_split_on(self):
        at_sign = with_rules(split_on=("&", "/", "\\", "@"))
        self.assertEqual(
            named("San Bernardino @ Monte Vista", at_sign), ("San Bernardino/Monte Vista", "intersection")
        )
        plus = with_rules(split_on=("&", "/", "\\", "+"))
        self.assertEqual(named("Streeter + Sierra", plus), ("Streeter/Sierra", "intersection"))


class TestBackslashesInPlaceNames(TestCase):
    def test_a_station_takes_the_slash_separator(self):
        self.assertEqual(
            named("Harbor Transitway \\ Harbor Fwy Station", METRO),
            ("Harbor Transitway/Harbor Fwy Station", "station"),
        )
        self.assertEqual(
            named("Harbor Transitway \\ 37th St \\ USC", METRO), ("Harbor Transitway/37th St/USC", "unparsed")
        )

    def test_a_named_place_takes_the_slash_separator(self):
        self.assertEqual(
            named("Orangethorpe \\ East Entry Park & Ride", METRO),
            ("Orangethorpe/East Entry Park & Ride", "named_place"),
        )


class TestAmpersandJoinsStreetsIsOptIn(TestCase):
    def test_off_by_default(self):
        self.assertEqual(named("Melrose & Wilton", METRO), ("Melrose & Wilton", "named_place"))

    def test_on_it_makes_an_intersection(self):
        joined = with_rules(ampersand_joins_streets=True)
        self.assertEqual(named("Melrose & Wilton", joined), ("Melrose/Wilton", "intersection"))

    def test_a_stop_described_between_two_streets_stays_whole(self):
        joined = with_rules(ampersand_joins_streets=True)
        self.assertEqual(
            named("Allington St between Palo Verde & Canehill", joined),
            ("Allington St between Palo Verde & Canehill", "named_place"),
        )
        self.assertEqual(named("Allington St between Palo Verde Ave & Canehill St", joined)[1], "named_place")

    def test_a_place_word_still_wins(self):
        joined = with_rules(ampersand_joins_streets=True)
        self.assertEqual(
            named("Fullerton Park & Ride Dock 14", joined), ("Fullerton Park & Ride Dock 14", "named_place")
        )


class TestProfileKeys(TestCase):
    def refused(self, stop_name_yaml):
        with self.assertRaises(ProfileError) as raised:
            parse_profile_yaml(f"carrier_code: XX\nstop_name:\n{stop_name_yaml}\n", "XX.yaml")
        return str(raised.exception)

    def test_split_words_must_be_words(self):
        self.assertIn("split_words", self.refused('  split_words: ["&"]'))
        self.assertIn("split_words", self.refused('  split_words: "and"'))
        self.assertIn("split_words", self.refused('  split_words: ["and or"]'))

    def test_ampersand_joins_streets_must_be_a_boolean(self):
        self.assertIn("ampersand_joins_streets", self.refused('  ampersand_joins_streets: "yes"'))

    def test_the_keys_are_read(self):
        text = "carrier_code: XX\nstop_name:\n  split_words: [And, at]\n  ampersand_joins_streets: true\n"
        rules = parse_profile_yaml(text, "XX.yaml").stop_name
        self.assertEqual((rules.split_words, rules.ampersand_joins_streets), (("and", "at"), True))


class TestAProfileCanInheritTheDefault(TestCase):
    TEXT = "carrier_code: FZ\ninherit_default: true\nstop_name:\n  split_words: [and]\n"

    def test_unset_sections_and_stop_keys_come_from_the_default(self):
        profiles = profile_set(self.TEXT, "FZ")
        profile = profiles.for_carrier("FZ", "Foothill Transit")
        default = profiles.default
        self.assertEqual(profile.headsign, default.headsign)
        self.assertEqual(profile.direction_map, default.direction_map)
        self.assertEqual(profile.route_name, default.route_name)
        self.assertEqual(profile.stop_name.suffixes, default.stop_name.suffixes)
        self.assertEqual(profile.stop_name.split_words, ("and",))

    def test_the_display_name_is_the_carrier_name(self):
        profiles = profile_set(self.TEXT, "FZ")
        self.assertEqual(profiles.for_carrier("FZ", "Foothill Transit").carrier_display_name, "Foothill Transit")
        self.assertEqual(profiles.for_carrier("FZ").carrier_display_name, "FZ")
        declared = profile_set(
            self.TEXT.replace("inherit_default", "carrier_display_name: Foothill\ninherit_default"), "FZ"
        )
        self.assertEqual(declared.for_carrier("FZ", "Foothill Transit").carrier_display_name, "Foothill")

    def test_an_inheriting_profile_is_not_curated_for_the_location_tiebreak(self):
        profiles = profile_set(self.TEXT, "FZ")
        self.assertFalse(_curated(profiles, "FZ"))
        self.assertTrue(_curated(profile_set("carrier_code: FZ\ncarrier_display_name: Foothill\n", "FZ"), "FZ"))

    def test_a_profile_without_it_keeps_its_own_empty_sections(self):
        profiles = profile_set("carrier_code: FZ\ncarrier_display_name: Foothill\n", "FZ")
        self.assertEqual(profiles.for_carrier("FZ").direction_map, {})
