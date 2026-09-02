import os
import tempfile
from unittest import TestCase

from redash.transit_naming.profile_loader import CORE_PROFILE_DIR, load_profiles
from redash.transit_naming.profiles import CORE_REVISION, ProfileError
from tests.query_runner.transit_naming_fixtures import MT_YAML, write_profile_dir

OVERRIDES = "kind,key,public_name,note\nstop,3000001,Pico/Rimpau,backslash in source\n"
MT807 = 'MT807: {public_name: "Metro K Line", short_name: K, mode: light_rail, color: "E56DB1"}'


class TestLoadProfiles(TestCase):
    def test_core_directory_alone_yields_the_default_profile(self):
        profiles = load_profiles([CORE_PROFILE_DIR])
        self.assertEqual(sorted(profiles.profiles), [])
        self.assertTrue(profiles.default.is_default)
        self.assertEqual(profiles.default.route_name.pattern, "{brand} Line {route_number}")
        self.assertEqual(profiles.default.route_name.brand_from, ("carrier_display_name",))
        self.assertEqual(profiles.default.stop_name.separator, "/")

    def test_for_carrier_substitutes_the_carrier_into_the_default(self):
        profiles = load_profiles([CORE_PROFILE_DIR])
        burbank = profiles.for_carrier("BU", "Burbank Bus")
        self.assertEqual(burbank.carrier_code, "BU")
        self.assertEqual(burbank.carrier_display_name, "Burbank Bus")
        self.assertTrue(burbank.is_default)

    def test_a_pack_directory_adds_a_carrier(self):
        with tempfile.TemporaryDirectory() as pack:
            write_profile_dir(pack, {"MT.yaml": MT_YAML, "MT.csv": OVERRIDES})
            profiles = load_profiles([CORE_PROFILE_DIR, pack])
        metro = profiles.for_carrier("MT", "Metro")
        self.assertFalse(metro.is_default)
        self.assertEqual(metro.carrier_display_name, "Metro")
        self.assertEqual([s.name for s in metro.gtfs_sources], ["bus", "rail"])
        self.assertEqual(metro.aliases["MT950"].gtfs_route_id, "910-13201")
        self.assertEqual(metro.route_name.route_names["MT801"].public_name, "Metro A Line")
        self.assertEqual(metro.route_name.brand_bands[0].brand, "Metro Local Line")
        self.assertEqual(metro.override_for("stop", "3000001").public_name, "Pico/Rimpau")
        self.assertIsNone(metro.override_for("route", "MT094"))
        self.assertEqual(metro.direction_letter("MT094", "0"), "N")
        self.assertEqual(metro.direction_letter("MT030", 1), "W")

    def test_revision_is_core_plus_a_digest_of_every_loaded_file(self):
        with tempfile.TemporaryDirectory() as pack:
            write_profile_dir(pack, {"MT.yaml": MT_YAML})
            first = load_profiles([CORE_PROFILE_DIR, pack])
            write_profile_dir(pack, {"MT.yaml": MT_YAML.replace('separator: "/"', 'separator: " & "')})
            second = load_profiles([CORE_PROFILE_DIR, pack])
        self.assertTrue(first.revision.startswith(CORE_REVISION + "+"))
        self.assertEqual(len(first.revision), len(CORE_REVISION) + 13)
        self.assertNotEqual(first.revision, second.revision)
        self.assertEqual(len(first.files), 2)

    def test_a_carrier_in_two_directories_names_both_files(self):
        with tempfile.TemporaryDirectory() as one, tempfile.TemporaryDirectory() as two:
            write_profile_dir(one, {"MT.yaml": MT_YAML})
            write_profile_dir(two, {"MT.yaml": MT_YAML})
            with self.assertRaises(ProfileError) as raised:
                load_profiles([CORE_PROFILE_DIR, one, two])
        self.assertIn(os.path.join(one, "MT.yaml"), str(raised.exception))
        self.assertIn(os.path.join(two, "MT.yaml"), str(raised.exception))

    def test_a_missing_default_is_an_error(self):
        with tempfile.TemporaryDirectory() as empty:
            with self.assertRaises(ProfileError) as raised:
                load_profiles([empty])
        self.assertIn("default.yaml", str(raised.exception))


class TestProfileValidation(TestCase):
    def load_variant(self, replace_from, replace_to, csv=None):
        files = {"MT.yaml": MT_YAML.replace(replace_from, replace_to)}
        if csv is not None:
            files["MT.csv"] = csv
        with tempfile.TemporaryDirectory() as pack:
            write_profile_dir(pack, files)
            with self.assertRaises(ProfileError) as raised:
                load_profiles([CORE_PROFILE_DIR, pack])
        return raised.exception

    def test_unknown_top_level_key(self):
        error = self.load_variant('time_format: "h:mma"', 'time_format: "h:mma"\nbogus: 1')
        self.assertEqual((error.carrier, error.field), ("MT", "bogus"))
        self.assertTrue(error.file.endswith("MT.yaml"))

    def test_pattern_with_unknown_placeholder(self):
        error = self.load_variant('pattern: "{brand} {route_number}"', 'pattern: "{brand} {nope}"')
        self.assertEqual(error.field, "route_name.pattern")
        self.assertIn("nope", str(error))

    def test_unknown_join_strategy(self):
        error = self.load_variant("join: [short_name, route_id_prefix]", "join: [short_name, fuzzy]")
        self.assertEqual(error.field, "gtfs_sources[0].join")

    def test_alias_naming_an_undeclared_source(self):
        error = self.load_variant("MT950: {source: bus,", "MT950: {source: ferry,")
        self.assertEqual(error.field, "aliases.MT950.source")

    def test_duplicate_yaml_key_is_refused(self):
        error = self.load_variant(
            "carrier_display_name: Metro", "carrier_display_name: Metro\ncarrier_display_name: LA Metro"
        )
        self.assertIn("carrier_display_name", str(error))

    def test_invalid_hex_color(self):
        error = self.load_variant('color: "0072BC"', 'color: "blue"')
        self.assertEqual(error.field, "route_name.route_names.MT801.color")

    def test_route_names_entry_without_public_name(self):
        error = self.load_variant(MT807, "MT807: {short_name: K}")
        self.assertEqual(error.field, "route_name.route_names.MT807.public_name")

    def test_override_with_bad_kind(self):
        error = self.load_variant("x", "x", csv="kind,key,public_name,note\nline,MT094,Nope,\n")
        self.assertEqual((error.row, error.field), (2, "kind"))
        self.assertTrue(error.file.endswith("MT.csv"))

    def test_duplicate_override_key(self):
        error = self.load_variant("x", "x", csv="kind,key,public_name,note\nroute,MT094,A,\nroute,MT094,B,\n")
        self.assertEqual((error.row, error.field), (3, "key"))
