from unittest import TestCase

from redash.transit_naming import provenance
from redash.transit_naming.profile_loader import CORE_PROFILE_DIR, build_profile_set
from redash.transit_naming.routes import name_route, parse_route_number, route_row
from redash.transit_naming.snapshot import ResolvedRoute
from tests.query_runner.transit_naming_fixtures import (
    BU_ROUTES,
    MT_ROUTES,
    MT_YAML,
    metro_profile,
    metro_profiles,
)

ROUTES = {r["route_code"]: r for r in MT_ROUTES}


def resolved(route_id, short, long, route_type="3", color="", text="", source="bus", provenance_value=provenance.GTFS):
    return ResolvedRoute(route_id, short, long, route_type, color, text, source, provenance_value, "digest-bus")


class TestParseRouteNumber(TestCase):
    def test_strips_prefix_and_leading_zeros(self):
        self.assertEqual(parse_route_number("MT094", "MT"), "94")
        self.assertEqual(parse_route_number("MT022", "MT"), "22")
        self.assertEqual(parse_route_number("MT801", "MT"), "801")

    def test_keeps_alpha_remainders_whole(self):
        self.assertEqual(parse_route_number("ML SB", "ML"), "SB")
        self.assertEqual(parse_route_number("BUORA", "BU"), "ORA")

    def test_a_code_without_the_prefix_is_used_whole(self):
        self.assertEqual(parse_route_number("0480", "MT"), "480")


class TestNameRouteWithGtfs(TestCase):
    def setUp(self):
        self.profile = metro_profile(with_overrides=False)

    def test_local_bus_from_long_name(self):
        name = name_route(ROUTES["MT094"], self.profile, resolved("94-13201", "94", "Metro Local Line"))
        self.assertEqual(
            (name.public_name, name.short_name, name.brand, name.mode),
            ("Metro Local Line 94", "94", "Metro Local Line", "bus"),
        )
        self.assertEqual((name.public_name_source, name.brand_source), (provenance.GTFS, provenance.GTFS))
        self.assertEqual(name.gtfs_route_id, "94-13201")

    def test_textual_short_name_with_no_long_name_is_the_public_name(self):
        name = name_route(ROUTES["MT022"], self.profile, resolved("22-13201", "South Bay Dodger Stadium Express", ""))
        self.assertEqual(name.public_name, "South Bay Dodger Stadium Express")
        self.assertEqual(name.short_name, "South Bay Dodger Stadium Express")
        self.assertEqual(name.public_name_source, provenance.GTFS)

    def test_alias_provenance_travels(self):
        name = name_route(
            ROUTES["MT950"],
            self.profile,
            resolved("910-13201", "", "Metro J Line (Silver) 910/950", provenance_value=provenance.ALIAS),
        )
        self.assertEqual(name.public_name, "Metro J Line (Silver)")
        self.assertEqual(name.short_name, "J")
        self.assertEqual(name.mode, "busway")
        self.assertEqual(name.public_name_source, provenance.ALIAS)

    def test_busway_keeps_its_own_parenthetical(self):
        name = name_route(
            ROUTES["MT901"],
            self.profile,
            resolved("901-13201", "", "Metro G Line (Orange) 901", color="FC4C02", text="FFFFFF"),
        )
        self.assertEqual(name.public_name, "Metro G Line (Orange)")
        self.assertEqual((name.color, name.color_source), ("FC4C02", provenance.GTFS))

    def test_rail_gets_the_legacy_color(self):
        name = name_route(
            ROUTES["MT801"], self.profile, resolved("801", "", "Metro A Line", "0", "0072BC", "FFFFFF", source="rail")
        )
        self.assertEqual((name.public_name, name.short_name, name.mode), ("Metro A Line (Blue)", "A", "light_rail"))

    def test_rail_without_a_legacy_color_stays_bare(self):
        name = name_route(
            ROUTES["MT807"], self.profile, resolved("807", "", "Metro K Line", "0", "E56DB1", "000000", source="rail")
        )
        self.assertEqual(name.public_name, "Metro K Line")

    def test_combined_short_name_uses_the_mca_route_number(self):
        name = name_route(ROUTES["MT010"], self.profile, resolved("10-13201", "10/48", "Metro Local Line"))
        self.assertEqual((name.public_name, name.short_name), ("Metro Local Line 10", "10"))

    def test_long_name_column_is_the_description_not_the_public_name(self):
        name = name_route(ROUTES["MT030"], self.profile, resolved("30-13201", "30", "Metro Local Line"))
        self.assertEqual(name.long_name, "Metro Local Line")
        name = name_route(ROUTES["MT030"], self.profile, None)
        self.assertEqual(name.long_name, "Metro Local - Eastbound to Little Tokyo")

    def test_mca_line_color_beats_the_profile_but_not_gtfs(self):
        name = name_route(ROUTES["MT801"], self.profile, None)
        self.assertEqual((name.color, name.color_source), ("0072BC", provenance.PASSTHROUGH))
        name = name_route(ROUTES["MT807"], self.profile, None)
        self.assertEqual((name.color, name.color_source), ("E56DB1", provenance.RULE))


class TestNameRouteWithoutGtfs(TestCase):
    def setUp(self):
        self.profile = metro_profile(with_overrides=False)

    def test_band_names_a_local_bus(self):
        name = name_route(ROUTES["MT094"], self.profile, None)
        self.assertEqual((name.public_name, name.brand, name.mode), ("Metro Local Line 94", "Metro Local Line", "bus"))
        self.assertEqual(
            (name.public_name_source, name.brand_source, name.gtfs_route_id), (provenance.RULE, provenance.RULE, "")
        )

    def test_band_names_a_rapid_bus(self):
        self.assertEqual(name_route(ROUTES["MT720"], self.profile, None).public_name, "Metro Rapid Line 720")

    def test_route_names_entry_beats_the_band(self):
        name = name_route(ROUTES["MT009"], self.profile, None)
        self.assertEqual((name.public_name, name.short_name), ("Dodger Stadium Express", "9"))

    def test_route_names_entry_for_rail_gets_the_legacy_color(self):
        name = name_route(ROUTES["MT801"], self.profile, None)
        self.assertEqual((name.public_name, name.short_name, name.mode), ("Metro A Line (Blue)", "A", "light_rail"))

    def test_route_names_entry_for_a_busway(self):
        name = name_route(ROUTES["MT950"], self.profile, None)
        self.assertEqual((name.public_name, name.short_name, name.mode), ("Metro J Line (Silver)", "J", "busway"))

    def test_side_channel_is_used_when_no_rule_names_the_route(self):
        profile = metro_profiles().for_carrier("BU", "Burbank Bus")
        name = name_route(
            BU_ROUTES[0], profile, None, side_channel={"line_name": "Burbank Bus", "line_short_name": "Orange"}
        )
        self.assertEqual(name.public_name, "Burbank Bus Line ORA")
        self.assertEqual(name.public_name_source, provenance.RULE)

    def test_default_profile_names_a_partner_route(self):
        profile = metro_profiles().for_carrier("BU", "Burbank Bus")
        name = name_route(BU_ROUTES[0], profile, None)
        self.assertEqual(
            (name.public_name, name.short_name, name.brand), ("Burbank Bus Line ORA", "ORA", "Burbank Bus")
        )
        self.assertEqual(name.public_name_source, provenance.RULE)

    def test_side_channel_is_used_when_the_profile_names_neither_carrier_nor_band(self):
        yaml_text = MT_YAML.replace(
            "brand_from: [gtfs_route_long_name, brand_bands]", "brand_from: [gtfs_route_long_name]"
        )
        profile_set = build_profile_set(
            [CORE_PROFILE_DIR], extra_files={"/pack/naming_profiles": {"MT.yaml": yaml_text}}
        )
        profile = profile_set.for_carrier("MT", "Metro")
        name = name_route(
            ROUTES["MT094"], profile, None, side_channel={"line_name": "Metro Local Line", "line_short_name": "94"}
        )
        self.assertEqual(name.public_name, "Metro Local Line 94")
        self.assertEqual(name.public_name_source, provenance.MCA_SIDE_CHANNEL)


class TestOverrideAndRow(TestCase):
    def test_override_wins_last(self):
        name = name_route(ROUTES["MT010"], metro_profile(), resolved("10-13201", "10/48", "Metro Local Line"))
        self.assertEqual(
            (name.public_name, name.public_name_source), ("Metro Local Line 10 (Melrose)", provenance.OVERRIDE)
        )

    def test_row_has_the_spec_columns_in_order(self):
        name = name_route(ROUTES["MT094"], metro_profile(), resolved("94-13201", "94", "Metro Local Line"))
        row = route_row(ROUTES["MT094"], name, "2026.09.02+abc", "digest-bus")
        self.assertEqual(
            list(row),
            [
                "carrier_code",
                "carrier_id",
                "carrier_name",
                "route_code",
                "route_id",
                "line_code",
                "line_id",
                "route_number",
                "brand",
                "public_name",
                "short_name",
                "long_name",
                "mode",
                "color",
                "text_color",
                "gtfs_route_id",
                "public_name_source",
                "brand_source",
                "color_source",
                "normalization_revision",
                "gtfs_digest",
            ],
        )
        self.assertEqual((row["route_code"], row["route_id"], row["line_code"]), ("MT094", 1, "094"))
        self.assertEqual((row["normalization_revision"], row["gtfs_digest"]), ("2026.09.02+abc", "digest-bus"))


class TestReviewFindings(TestCase):
    def setUp(self):
        self.profile = metro_profile(with_overrides=False)

    def test_alias_provenance_reaches_the_color(self):
        silver = resolved(
            "910-13201", "", "Metro J Line (Silver) 910/950", color="ADB8BF", provenance_value=provenance.ALIAS
        )
        name = name_route(ROUTES["MT950"], self.profile, silver)
        self.assertEqual((name.color, name.color_source), ("ADB8BF", provenance.ALIAS))

    def test_side_channel_fills_the_brand_and_its_source(self):
        narrowed = MT_YAML.replace(
            "brand_from: [gtfs_route_long_name, brand_bands]", "brand_from: [gtfs_route_long_name]"
        )
        profiles = build_profile_set([CORE_PROFILE_DIR], extra_files={"/pack": {"MT.yaml": narrowed}})
        channel = {"line_name": "Metro Local Line", "line_short_name": "94"}
        name = name_route(ROUTES["MT094"], profiles.for_carrier("MT"), None, side_channel=channel)
        self.assertEqual((name.brand, name.brand_source), ("Metro Local Line", provenance.MCA_SIDE_CHANNEL))

    def test_legacy_color_applies_to_any_carrier_letter_line(self):
        name = name_route(ROUTES["MT801"], self.profile, resolved("801", "", "Foothill A Line", "0", source="rail"))
        self.assertEqual(name.public_name, "Foothill A Line (Blue)")
