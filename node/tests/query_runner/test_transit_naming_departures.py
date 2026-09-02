from unittest import TestCase

from redash.query_runner.metrocloudalliance_departures import flatten_departures
from redash.transit_naming import provenance
from redash.transit_naming.departures import PUBLIC_DEPARTURE_COLUMNS, enrich_departures
from redash.transit_naming.routes import name_route
from redash.transit_naming.stops import name_stop
from tests.query_runner.transit_naming_fixtures import (
    MT_ROUTES,
    MT_STOPS_BY_ID,
    PREDICTION_STOP,
    metro_profile,
)

PROFILE = metro_profile()
ROUTES = {"30": name_route(next(r for r in MT_ROUTES if r["route_code"] == "MT030"), PROFILE, None)}
STOPS = {"1166": name_stop(MT_STOPS_BY_ID["1166"], PROFILE)}


class TestEnrichDepartures(TestCase):
    def rows(self):
        return enrich_departures(flatten_departures([PREDICTION_STOP]), ROUTES, STOPS, PROFILE, "rev", "dig")

    def test_raw_columns_are_renamed_and_public_ones_added(self):
        row = [r for r in self.rows() if r["raw_route"] == "30"][0]
        self.assertNotIn("route", row)
        self.assertEqual(
            (row["raw_route"], row["raw_headsign"], row["raw_stop_name"]),
            ("30", "Downtown LA- Little Tokyo-Arts Dist Sta.", "1st St/Main St"),
        )
        self.assertEqual((row["public_route_name"], row["public_route_short_name"]), ("Metro Local Line 30", "30"))
        self.assertEqual(row["public_headsign"], "Downtown LA - Little Tokyo - Arts Dist Station")
        self.assertEqual(row["public_stop_name"], "1st St/Main St")
        self.assertEqual(
            (row["public_route_name_source"], row["public_stop_name_source"], row["public_headsign_source"]),
            (provenance.RULE, provenance.RULE, provenance.RULE),
        )
        self.assertEqual(
            (row["pattern_code"], row["normalization_revision"], row["gtfs_digest"]), ("MT030 E", "rev", "dig")
        )

    def test_a_route_missing_from_the_map_is_named_by_the_rule(self):
        row = [r for r in self.rows() if r["raw_route"] == "999"][0]
        self.assertEqual((row["public_route_name"], row["public_route_name_source"]), ("Metro 999", provenance.RULE))

    def test_a_stop_missing_from_the_map_is_named_by_the_rule(self):
        rows = enrich_departures(flatten_departures([PREDICTION_STOP]), ROUTES, {}, PROFILE, "rev", "dig")
        self.assertEqual(
            (rows[0]["public_stop_name"], rows[0]["public_stop_name_source"]), ("1st St/Main St", provenance.RULE)
        )

    def test_column_doc_names_match_the_rows(self):
        names = [c.split(":")[0] for c in PUBLIC_DEPARTURE_COLUMNS]
        self.assertEqual(names, list(self.rows()[0]))


def mca_route_named(route_code):
    return name_route(next(r for r in MT_ROUTES if r["route_code"] == route_code), PROFILE, None)


def prediction_for(route_number, stop_id="1166", stop_name="1st St/Main St"):
    route = dict(PREDICTION_STOP["routes"][0], route=route_number, route_id=route_number)
    return dict(PREDICTION_STOP, stop_id=stop_id, stop_name=stop_name, routes=[route])


class TestReviewFindings(TestCase):
    def test_a_rail_stop_missing_from_the_map_keeps_rail_cleanup(self):
        stop = prediction_for("801", "80122", "Riverbrook - Park Station - Metro A-Line")
        rows = enrich_departures(flatten_departures([stop]), {"801": mca_route_named("MT801")}, {}, PROFILE, "r", "d")
        self.assertEqual(rows[0]["public_stop_name"], "Riverbrook - Park Station")

    def test_fallback_provenance_reflects_the_fallback_result(self):
        rows = enrich_departures(flatten_departures([prediction_for("10")]), {}, {}, PROFILE, "r", "d")
        self.assertEqual(
            (rows[0]["public_route_name"], rows[0]["public_route_name_source"]),
            ("Metro Local Line 10 (Melrose)", provenance.OVERRIDE),
        )
        rows = enrich_departures(
            flatten_departures([prediction_for("30", "3000001", "Pico \\ Rimpau")]), ROUTES, {}, PROFILE, "r", "d"
        )
        self.assertEqual(
            (rows[0]["public_stop_name"], rows[0]["public_stop_name_source"]), ("Pico/Rimpau", provenance.OVERRIDE)
        )

    def test_a_retired_stop_is_dropped_from_the_board(self):
        retired = {"10270": name_stop(MT_STOPS_BY_ID["10270"], PROFILE)}
        departures = flatten_departures([prediction_for("30", "10270", "Collis Ave/Cudahy St")])
        self.assertEqual(enrich_departures(departures, ROUTES, retired, PROFILE, "r", "d"), [])

    def test_short_name_source_is_independent_of_an_override(self):
        rows = enrich_departures(
            flatten_departures([prediction_for("10")]), {"10": mca_route_named("MT010")}, STOPS, PROFILE, "r", "d"
        )
        self.assertEqual(
            (rows[0]["public_route_name_source"], rows[0]["public_route_short_name_source"]),
            (provenance.OVERRIDE, provenance.RULE),
        )
