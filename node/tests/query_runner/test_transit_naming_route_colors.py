from unittest import TestCase

from redash.transit_naming import provenance
from redash.transit_naming.routes import name_route
from redash.transit_naming.snapshot import ResolvedRoute
from tests.query_runner.transit_naming_fixtures import MT_ROUTES, metro_profile

ROUTES = {r["route_code"]: r for r in MT_ROUTES}
PROFILE = metro_profile(with_overrides=False)


def resolved(color="", text=""):
    return ResolvedRoute("94-13201", "94", "Metro Local Line", "3", color, text, "bus", provenance.GTFS, "digest")


def colors(route_code, line_color, gtfs=None):
    name = name_route(dict(ROUTES[route_code], line_color=line_color), PROFILE, gtfs)
    return name.color, name.text_color, name.color_source


class TestCarrierFeedColor(TestCase):
    def test_black_from_the_carrier_feed_is_its_unset_value_so_the_route_has_no_color(self):
        self.assertEqual(colors("MT094", "000000"), ("", "", ""))

    def test_black_from_the_carrier_feed_does_not_hide_a_feed_without_colors(self):
        self.assertEqual(colors("MT094", "#000000", resolved()), ("", "", ""))

    def test_a_malformed_carrier_color_is_no_color(self):
        self.assertEqual(colors("MT094", "#00000"), ("", "", ""))
        self.assertEqual(colors("MT094", "blue"), ("", "", ""))

    def test_a_real_carrier_color_still_passes_through_normalized(self):
        self.assertEqual(colors("MT094", "#0072bc"), ("0072BC", "", provenance.PASSTHROUGH))

    def test_the_profile_entry_color_applies_when_the_carrier_sends_black(self):
        self.assertEqual(colors("MT807", "000000"), ("E56DB1", "", provenance.RULE))


class TestGtfsColor(TestCase):
    def test_black_published_in_gtfs_with_its_text_color_is_kept(self):
        self.assertEqual(colors("MT094", "", resolved("000000", "FFFFFF")), ("000000", "FFFFFF", provenance.GTFS))

    def test_gtfs_wins_over_the_carrier_feed(self):
        self.assertEqual(
            colors("MT094", "000000", resolved("E56DB1", "000000")), ("E56DB1", "000000", provenance.GTFS)
        )
