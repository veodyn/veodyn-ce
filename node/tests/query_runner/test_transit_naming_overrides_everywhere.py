from unittest import TestCase
from unittest.mock import patch

from redash.query_runner import metrocloudalliance_public as public
from redash.transit_naming import provenance
from redash.transit_naming.locations import location_rows
from redash.transit_naming.profiles import Override
from redash.transit_naming.stop_rows import stop_row
from redash.transit_naming.stops import name_stop
from tests.query_runner.test_metrocloudalliance_public import (
    PREDICTIONS,
    ROUTES,
    STOPS,
    PublicResourceCase,
    routes_by_params,
    stops_by_params,
)
from tests.query_runner.test_transit_naming_locations import member
from tests.query_runner.transit_naming_fixtures import (
    MT_STOPS,
    MT_STOPS_BY_ID,
    PREDICTION_STOP,
    metro_profiles,
)

CORRECTED = "Elmwood Corner (check)"


def with_stop_override(stop_id, public_name=CORRECTED, carrier="MT"):
    overrides = {carrier: {("stop", stop_id): Override("stop", stop_id, public_name, "")}}
    return metro_profiles().with_overrides(overrides)


def corrected(carrier, stop_id, rule_name, public_name=CORRECTED, **kwargs):
    row = member(carrier, stop_id, public_name, original=rule_name, **kwargs)
    row["public_name_source"] = provenance.OVERRIDE
    return row


class TestOriginalNameKeepsTheRuleName(TestCase):
    def test_a_stop_override_keeps_the_name_the_rules_produced(self):
        profile = with_stop_override("1").for_carrier("MT", "Metro")
        name = name_stop(MT_STOPS_BY_ID["1"], profile)
        self.assertEqual((name.public_name, name.public_name_source), (CORRECTED, provenance.OVERRIDE))
        self.assertEqual(name.original_public_name, "Paramount Bl/Slauson Av")
        row = stop_row(MT_STOPS_BY_ID["1"], name, "r1", "")
        self.assertEqual((row["public_name"], row["original_public_name"]), (CORRECTED, "Paramount Bl/Slauson Av"))

    def test_a_stop_without_an_override_still_repeats_its_name(self):
        name = name_stop(MT_STOPS_BY_ID["1"], with_stop_override("13574").for_carrier("MT", "Metro"))
        row = stop_row(MT_STOPS_BY_ID["1"], name, "r1", "")
        self.assertEqual(row["original_public_name"], row["public_name"])


class TestLocationsFollowAStopOverride(TestCase):
    def setUp(self):
        self.profiles = metro_profiles()

    def rows(self, members):
        return location_rows(members, self.profiles, {})

    def test_an_overridden_member_names_the_location_against_a_majority(self):
        rows = self.rows(
            [
                member("SM", "220", "Elmwood Av/Cedar St"),
                member("BB", "9", "Elmwood Av/Cedar St"),
                corrected("XA", "41", "Elmwood Av/Cedar St"),
            ]
        )
        row = rows[0]
        self.assertEqual((row["public_name"], row["public_name_source"]), (CORRECTED, provenance.OVERRIDE))
        self.assertEqual((row["chosen_carrier"], row["chosen_stop_id"], row["agreeing_stops"]), ("XA", "41", 1))
        self.assertEqual(row["names"], f"Elmwood Av/Cedar St; {CORRECTED}")

    def test_an_override_on_a_member_that_would_have_won_is_labelled_an_override(self):
        rows = self.rows([member("SM", "220", "Elmwood Av/Cedar St"), corrected("MT", "997", "Elmwood Av/Cedar St")])
        self.assertEqual(
            (rows[0]["public_name"], rows[0]["public_name_source"], rows[0]["agreeing_stops"]),
            (CORRECTED, provenance.OVERRIDE, 1),
        )

    def test_two_overridden_members_pick_the_curated_carrier_first(self):
        rows = self.rows(
            [
                corrected("SM", "220", "Elmwood Av/Cedar St", public_name="Elmwood West"),
                corrected("MT", "997", "Elmwood Av/Cedar St", public_name="Elmwood East"),
            ]
        )
        self.assertEqual((rows[0]["public_name"], rows[0]["chosen_carrier"]), ("Elmwood East", "MT"))

    def test_a_location_override_still_beats_a_stop_override(self):
        overrides = {"MT": {("location", "1000001"): Override("location", "1000001", "Elmwood Plaza", "")}}
        rows = location_rows(
            [member("SM", "220", "Elmwood Av/Cedar St"), corrected("MT", "997", "Elmwood Av/Cedar St")],
            metro_profiles().with_overrides(overrides),
            {},
        )
        self.assertEqual((rows[0]["public_name"], rows[0]["public_name_source"]), ("Elmwood Plaza", "override"))


class TestOverridesReachEveryPublicView(PublicResourceCase):
    def shared_corner(self, params):
        copies = [
            dict(MT_STOPS_BY_ID["1"], carrier_code=carrier, stop_id=stop_id, uuid=f"uuid-{carrier}-{stop_id}")
            for carrier, stop_id in (("SM", "220"), ("BB", "9"))
        ]
        return MT_STOPS + copies

    def run_with(self, profiles, query, by_url):
        with patch.object(public, "load_profile_set", return_value=profiles):
            data, _ = self.run_resource(query, by_url)
        return data["rows"]

    def test_the_location_of_an_overridden_stop_shows_the_override(self):
        corner = MT_STOPS_BY_ID["1"]["511_id"]
        query = '{"resource": "public_stop_locations", "params": {"stop_511_id": "%s"}}' % corner
        rows = self.run_with(with_stop_override("1"), query, {STOPS: self.shared_corner})
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["public_name"], rows[0]["public_name_source"]), (CORRECTED, provenance.OVERRIDE))
        self.assertEqual((rows[0]["chosen_carrier"], rows[0]["source_stops"]), ("MT", 3))

    def test_a_one_location_lookup_names_only_that_locations_stops(self):
        corner = MT_STOPS_BY_ID["1"]["511_id"]
        query = '{"resource": "public_stop_locations", "params": {"stop_511_id": "%s"}}' % corner
        with patch.object(public, "stop_row", wraps=public.stop_row) as named:
            rows = self.run_with(with_stop_override("1"), query, {STOPS: self.shared_corner})
        self.assertEqual([r["511_id"] for r in rows], [corner])
        self.assertEqual(sorted(call.args[0]["carrier_code"] for call in named.call_args_list), ["BB", "MT", "SM"])

    def test_every_location_is_still_listed_without_a_511_id(self):
        rows = self.run_with(
            with_stop_override("1"), '{"resource": "public_stop_locations"}', {STOPS: self.shared_corner}
        )
        self.assertEqual(len(rows), len({s["511_id"] for s in MT_STOPS}))

    def test_a_departures_board_shows_the_overridden_stop_name(self):
        query = '{"resource": "public_departures", "params": {"carrier_code": "MT", "stop_id": "1166"}}'
        rows = self.run_with(
            with_stop_override("1166"),
            query,
            {PREDICTIONS: [PREDICTION_STOP], ROUTES: routes_by_params, STOPS: stops_by_params},
        )
        self.assertTrue(rows)
        self.assertEqual(
            {(r["public_stop_name"], r["public_stop_name_source"]) for r in rows}, {(CORRECTED, provenance.OVERRIDE)}
        )
