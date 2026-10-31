from unittest import TestCase
from unittest.mock import patch

from redash.query_runner import metrocloudalliance_public as public
from redash.transit_naming.override_status import override_status
from redash.transit_naming.profiles import Override
from tests.query_runner.test_metrocloudalliance_public import (
    ROUTES,
    STOPS,
    PublicResourceCase,
    stops_by_params,
)
from tests.query_runner.transit_naming_fixtures import metro_profiles

AR_STOPS = [
    {"carrier_code": "AR", "stop_id": "133369", "511_id": ""},
    {"carrier_code": "AR", "stop_id": "133370", "511_id": "2011336"},
]
AR_ROUTES = [{"carrier_code": "AR", "route_code": "AR1"}]


def fake_fetch(calls):
    def fetch(path, params):
        calls.append((path, dict(params)))
        if params.get("carrier_code") != "AR":
            return []
        return AR_STOPS if path == "stops" else AR_ROUTES

    return fetch


def overrides(*entries):
    table = {}
    for kind, carrier, target in entries:
        table.setdefault(carrier, {})[(kind, target)] = Override(kind, target, f"{target} corrected", "why")
    return table


class TestOverrideStatus(TestCase):
    def status(self, *entries):
        self.calls = []
        return {row["target_id"]: row for row in override_status(overrides(*entries), fake_fetch(self.calls))}

    def test_a_stop_id_that_exists_is_applied(self):
        row = self.status(("stop", "AR", "133369"))["133369"]
        self.assertEqual((row["status"], row["matched_stop_id"], row["hint"]), ("applied", "133369", ""))
        self.assertEqual((row["public_name"], row["note"]), ("133369 corrected", "why"))

    def test_a_511_id_entered_as_a_stop_id_names_the_stop_it_belongs_to(self):
        row = self.status(("stop", "AR", "2011336"))["2011336"]
        self.assertEqual((row["status"], row["matched_stop_id"]), ("no_match", ""))
        self.assertEqual(row["hint"], "2011336 is the 511 id of AR stop 133370; enter 133370 as the stop id")

    def test_an_unknown_stop_id_says_nothing_matched(self):
        row = self.status(("stop", "AR", "999"))["999"]
        self.assertEqual(row["status"], "no_match")
        self.assertEqual(row["hint"], "AR has no stop with id 999")

    def test_an_unknown_carrier_says_the_carrier_sent_no_stops(self):
        row = self.status(("stop", "ZZ", "1"))["1"]
        self.assertEqual((row["status"], row["hint"]), ("no_match", "ZZ has no stop with id 1"))

    def test_a_route_code_is_checked_against_the_carriers_routes(self):
        rows = self.status(("route", "AR", "AR1"), ("route", "AR", "1"))
        self.assertEqual(rows["AR1"]["status"], "applied")
        self.assertEqual((rows["1"]["status"], rows["1"]["hint"]), ("no_match", "AR has no route with code 1"))

    def test_each_carrier_is_fetched_once_however_many_corrections_it_has(self):
        self.status(("stop", "AR", "133369"), ("stop", "AR", "2011336"), ("stop", "AR", "999"))
        self.assertEqual(self.calls, [("stops", {"carrier_code": "AR"})])

    def test_no_corrections_reads_nothing(self):
        self.assertEqual(self.status(), {})
        self.assertEqual(self.calls, [])


class TestNameOverridesResource(PublicResourceCase):
    def test_the_runner_reports_each_correction_against_the_carriers_stops(self):
        profiles = metro_profiles().with_overrides(overrides(("stop", "MT", "1"), ("stop", "MT", "1001")))
        with patch.object(public, "load_profile_set", return_value=profiles):
            data, _ = self.run_resource('{"resource": "name_overrides"}', {STOPS: stops_by_params, ROUTES: []})
        self.assertEqual([c["name"] for c in data["columns"]], public.PUBLIC_COLUMN_NAMES["name_overrides"])
        rows = {r["target_id"]: (r["status"], r["hint"]) for r in data["rows"]}
        self.assertEqual(rows["1"], ("applied", ""))
        self.assertEqual(rows["1001"], ("no_match", "1001 is the 511 id of MT stop 1; enter 1 as the stop id"))
