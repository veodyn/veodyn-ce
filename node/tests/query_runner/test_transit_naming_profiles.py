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


class TestLoaderRefusals(TestCase):
    def refused(self, replace_from, replace_to):
        with tempfile.TemporaryDirectory() as pack:
            write_profile_dir(pack, {"MT.yaml": MT_YAML.replace(replace_from, replace_to)})
            with self.assertRaises(ProfileError) as raised:
                load_profiles([CORE_PROFILE_DIR, pack])
        return raised.exception

    def test_a_configured_directory_that_does_not_exist_is_an_error(self):
        with self.assertRaises(ProfileError) as raised:
            load_profiles([CORE_PROFILE_DIR, "/nonexistent/naming_profiles"])
        self.assertIn("/nonexistent/naming_profiles", str(raised.exception))

    def test_an_empty_carrier_code_is_refused(self):
        error = self.refused("carrier_code: MT", 'carrier_code: ""')
        self.assertEqual(error.field, "carrier_code")

    def test_a_malformed_pattern_is_refused(self):
        error = self.refused('pattern: "{brand} {route_number}"', 'pattern: "{brand {route_number}"')
        self.assertEqual(error.field, "route_name.pattern")
        error = self.refused('pattern: "{brand} {route_number}"', 'pattern: "{Brand} {route_number}"')
        self.assertEqual(error.field, "route_name.pattern")

    def test_duplicate_gtfs_source_names_are_refused(self):
        error = self.refused("  - name: rail", "  - name: bus")
        self.assertEqual(error.field, "gtfs_sources[1].name")

    def test_unknown_keys_inside_records_are_refused(self):
        error = self.refused("short_name: K, mode: light_rail", "short_nam: K, mode: light_rail")
        self.assertEqual(error.field, "route_name.route_names.MT807.short_nam")
        error = self.refused("    join: [route_id_prefix]", "    join: [route_id_prefix]\n    joins: []")
        self.assertEqual(error.field, "gtfs_sources[1].joins")
        rapid = '{from: 700, to: 799, brand: "Metro Rapid Line", mode: bus}'
        error = self.refused(rapid, rapid.replace("mode", "mod"))
        self.assertEqual(error.field, "route_name.brand_bands[4].mod")
        error = self.refused('gtfs_route_id: "910-13201", note:', 'gtfs_route_id: "910-13201", notes:')
        self.assertEqual(error.field, "aliases.MT950.notes")

    def test_revision_ignores_the_directory_the_files_live_in(self):
        with tempfile.TemporaryDirectory() as one, tempfile.TemporaryDirectory() as two:
            write_profile_dir(one, {"MT.yaml": MT_YAML})
            write_profile_dir(two, {"MT.yaml": MT_YAML})
            first = load_profiles([CORE_PROFILE_DIR, one]).revision
            second = load_profiles([CORE_PROFILE_DIR, two]).revision
        self.assertEqual(first, second)

    def test_revision_ignores_which_directory_sorts_first(self):
        burbank = MT_YAML.replace("carrier_code: MT", "carrier_code: BU").replace("MT950:", "BU950:")
        with tempfile.TemporaryDirectory() as root:
            first, second = os.path.join(root, "a"), os.path.join(root, "z")
            os.makedirs(first)
            os.makedirs(second)
            write_profile_dir(first, {"MT.yaml": MT_YAML})
            write_profile_dir(second, {"BU.yaml": burbank})
            one = load_profiles([CORE_PROFILE_DIR, first, second]).revision
            os.rename(os.path.join(first, "MT.yaml"), os.path.join(second, "MT.yaml"))
            os.rename(os.path.join(second, "BU.yaml"), os.path.join(first, "BU.yaml"))
            other = load_profiles([CORE_PROFILE_DIR, first, second]).revision
        self.assertEqual(one, other)

    def test_duplicate_key_error_names_the_carrier(self):
        error = self.refused(
            "carrier_display_name: Metro", "carrier_display_name: Metro\ncarrier_display_name: LA Metro"
        )
        self.assertEqual((error.carrier, error.field), ("MT", "carrier_display_name"))
