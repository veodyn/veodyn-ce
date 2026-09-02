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
