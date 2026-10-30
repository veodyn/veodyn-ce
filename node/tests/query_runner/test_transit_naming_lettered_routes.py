from unittest import TestCase

from redash.transit_naming import provenance
from redash.transit_naming.profile_loader import CORE_PROFILE_DIR, build_profile_set
from redash.transit_naming.routes import name_route


def route(carrier, route_code, route_name, line_name="", line_code=""):
    return {
        "carrier_code": carrier,
        "route_code": route_code,
        "route_name": route_name,
        "line_name": line_name,
        "line_code": line_code or route_code[2:].strip(),
        "line_color": "",
    }


def profile_for(carrier, display, yaml_text=None):
    files = {f"{carrier}.yaml": yaml_text} if yaml_text else {}
    profiles = build_profile_set([CORE_PROFILE_DIR], extra_files={"/pack/naming_profiles": files})
    return profiles.for_carrier(carrier, display)


UNBRANDED_YAML = "carrier_code: BU\ninherit_default: true\nroute_name:\n  brand_from: [gtfs_route_long_name]\n"
DASH_YAML = "carrier_code: DA\ninherit_default: true\nstop_name:\n  keep_upper: [DASH]\n"


class TestLetteredRoutesTakeTheirDescriptiveName(TestCase):
    def test_a_route_named_by_its_operator_reads_that_name(self):
        name = name_route(
            route("BU", "BUPIN", "BURBANK BUS PINK ROUTE", "BURBANK BUS PINK ROUTE"),
            profile_for("BU", "Burbank Bus"),
            None,
        )
        self.assertEqual((name.public_name, name.short_name), ("Burbank Bus Pink Route", "PIN"))
        self.assertEqual(name.public_name_source, provenance.RULE)

    def test_the_line_name_is_used_when_the_route_name_is_only_the_code(self):
        name = name_route(
            route("DA", "DAPAN", "DAPAN", "DASH PANORAMA CITY - VAN NUYS"), profile_for("DA", "LADOT", DASH_YAML), None
        )
        self.assertEqual(name.public_name, "DASH Panorama City - Van Nuys")

    def test_a_route_name_of_short_codes_is_not_descriptive(self):
        name = name_route(
            route("CX", "CX LB", "CE LB", "LONG BEACH - CATALINA LANDING - AVALON"),
            profile_for("CX", "Catalina Express"),
            None,
        )
        self.assertEqual(name.public_name, "Long Beach - Catalina Landing - Avalon")

    def test_without_a_descriptive_name_the_line_pattern_stays(self):
        self.assertEqual(
            name_route(route("BU", "BUORA", "BUORA", "BUORA"), profile_for("BU", "Burbank Bus"), None).public_name,
            "Burbank Bus Line ORA",
        )
        self.assertEqual(
            name_route(route("LY", "LY  A", "LY  A"), profile_for("LY", "Lynwood Trolley"), None).public_name,
            "Lynwood Trolley Line A",
        )

    def test_a_numbered_route_keeps_the_line_pattern(self):
        name = name_route(
            route("BU", "BU001", "BURBANK BUS ROUTE ONE", "BURBANK BUS ROUTE ONE"),
            profile_for("BU", "Burbank Bus"),
            None,
        )
        self.assertEqual(name.public_name, "Burbank Bus Line 1")

    def test_a_side_channel_name_is_kept(self):
        name = name_route(
            route("BU", "BUPIN", "BURBANK BUS PINK ROUTE", "BURBANK BUS PINK ROUTE"),
            profile_for("BU", "Burbank Bus", UNBRANDED_YAML),
            None,
            side_channel={"line_name": "Burbank Bus Line", "line_short_name": "Pink"},
        )
        self.assertEqual(
            (name.public_name, name.public_name_source), ("Burbank Bus Line Pink", provenance.MCA_SIDE_CHANNEL)
        )
