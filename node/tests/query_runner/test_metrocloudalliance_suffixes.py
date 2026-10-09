import json
import os
import subprocess
import sys
import tempfile
from unittest import TestCase
from unittest.mock import patch

from redash import redis_connection
from redash.query_runner import metrocloudalliance_public as public
from redash.query_runner.metrocloudalliance import MetroCloudAlliance
from redash.transit_naming.suffixes import index_key, source_hash
from tests.query_runner.test_metrocloudalliance_public import (
    PREDICTIONS,
    ROUTES,
    STOPS,
    PublicResourceCase,
    responder,
    routes_by_params,
    stops_by_params,
)
from tests.query_runner.transit_naming_fixtures import (
    MT_STOPS,
    PREDICTION_STOP,
    mca_stop,
    metro_suffix_profiles,
)

BASELINE = os.path.join(os.path.dirname(__file__), "transit_naming_baseline.json")
KEY_PATTERN = "transit-naming:suffix-index:*"
DONOR = mca_stop("99001", "Grand/Pico", 34.0400, -118.2600, "Grand Av", "Pico Bl")
BARE_GRAND = mca_stop("13574", "Grand/Pico", 34.0405, -118.2600, "Grand", "Pico")
BARE_FIRST = mca_stop("1166", "1st/Main", 34.052019, -118.243174, "1st", "Main", direction="East")
DONOR_FIRST = mca_stop("99002", "1st St/Main St", 34.0521, -118.243174, "1st St", "Main St")
SUFFIX_STOPS = [stop for stop in MT_STOPS if stop["stop_id"] not in ("13574", "1166")] + [
    BARE_GRAND,
    BARE_FIRST,
    DONOR,
    DONOR_FIRST,
]


def clear_indexes():
    for key in redis_connection.scan_iter(KEY_PATTERN):
        redis_connection.delete(key)


def stops_responder(stops, log=None):
    def respond(params):
        if log is not None:
            log.append({k: v for k, v in params.items() if k != "api_key"})
        if params.get("stop_id"):
            return [s for s in stops if s["stop_id"] == params["stop_id"]]
        return stops

    return respond


class SuffixResourceCase(PublicResourceCase):
    def setUp(self):
        super().setUp()
        clear_indexes()
        self.addCleanup(clear_indexes)
        self.profile_set = metro_suffix_profiles()
        patcher = patch.object(public, "load_profile_set", return_value=self.profile_set)
        patcher.start()
        self.addCleanup(patcher.stop)

    def query(self, resource, params, by_url, runner=None):
        text = json.dumps({"resource": resource, "params": params})
        runner = runner or self.runner
        with patch("redash.query_runner.metrocloudalliance.requests.get", side_effect=responder(by_url)) as get:
            data, error = runner.run_query(text, None)
        self.assertIsNone(error, error)
        return data, get


class TestCompletionAcrossResources(SuffixResourceCase):
    def test_public_stops_completes_and_explains(self):
        data, _ = self.query("public_stops", {"carrier_code": "MT"}, {STOPS: stops_responder(SUFFIX_STOPS)})
        row = {r["stop_id"]: r for r in data["rows"]}["13574"]
        self.assertEqual(
            (row["public_name"], row["original_public_name"], row["suffix_completion"], row["public_name_source"]),
            ("Grand Av/Pico Bl", "Grand/Pico", "same_intersection", "rule"),
        )

    def test_a_stop_id_filtered_call_completes_against_the_carriers_index(self):
        log = []
        data, _ = self.query(
            "public_stops", {"carrier_code": "MT", "stop_id": "13574"}, {STOPS: stops_responder(SUFFIX_STOPS, log)}
        )
        self.assertEqual([r["public_name"] for r in data["rows"]], ["Grand Av/Pico Bl"])
        self.assertEqual(log[-1], {"carrier_code": "MT"})

    def test_route_stops_use_the_completed_names(self):
        data, _ = self.query(
            "public_route_stops",
            {"carrier_code": "MT", "route_code": "MT030"},
            {ROUTES: routes_by_params, STOPS: stops_responder(SUFFIX_STOPS)},
        )
        names = {r["stop_id"]: r["public_name"] for r in data["rows"]}
        self.assertEqual((names["13574"], names["1166"]), ("Grand Av/Pico Bl", "1st St/Main St"))

    def test_locations_show_the_completed_name_of_the_chosen_member(self):
        data, _ = self.query("public_stop_locations", {}, {STOPS: stops_responder(SUFFIX_STOPS)})
        by_id = {r["511_id"]: r for r in data["rows"]}
        row = by_id[BARE_GRAND["511_id"]]
        self.assertEqual((row["public_name"], row["agreeing_stops"]), ("Grand Av/Pico Bl", 1))

    def test_departures_use_the_completed_name_for_a_fetched_stop(self):
        data, _ = self.query(
            "public_departures",
            {"carrier_code": "MT", "stop_id": "1166"},
            {PREDICTIONS: [PREDICTION_STOP], ROUTES: routes_by_params, STOPS: stops_responder(SUFFIX_STOPS)},
        )
        row = [r for r in data["rows"] if r["raw_route"] == "30"][0]
        self.assertEqual(row["public_stop_name"], "1st St/Main St")

    def test_departures_keep_todays_name_when_the_stop_cannot_be_fetched(self):
        prediction = dict(PREDICTION_STOP, stop_name="1st/Main")
        data, _ = self.query(
            "public_departures",
            {"carrier_code": "MT", "stop_id": "1166"},
            {PREDICTIONS: [prediction], ROUTES: routes_by_params, STOPS: stops_responder([DONOR_FIRST])},
        )
        row = [r for r in data["rows"] if r["raw_route"] == "30"][0]
        self.assertEqual(row["public_stop_name"], "1st/Main")


class TestIndexInRedis(SuffixResourceCase):
    def stored_keys(self):
        return sorted(redis_connection.scan_iter(KEY_PATTERN))

    def lookup(self, runner=None, log=None):
        return self.query(
            "public_stops",
            {"carrier_code": "MT", "stop_id": "13574"},
            {STOPS: stops_responder(SUFFIX_STOPS, log)},
            runner,
        )

    def test_the_key_names_the_carrier_revision_and_a_hash_that_hides_the_api_key(self):
        self.lookup()
        (key,) = self.stored_keys()
        digest = source_hash(self.runner.base_url, "demo")
        self.assertEqual(key, f"transit-naming:suffix-index:MT:{self.profile_set.revision}:{digest}")
        self.assertEqual(key, index_key("MT", self.profile_set.revision, digest))
        self.assertNotIn("demo", key)
        self.assertEqual(len(digest), 64)
        self.assertTrue(0 < redis_connection.ttl(key) <= 6 * 3600)

    def test_a_second_call_reuses_the_stored_index(self):
        first, second = [], []
        self.lookup(log=first)
        self.lookup(log=second)
        self.assertIn({"carrier_code": "MT"}, first)
        self.assertNotIn({"carrier_code": "MT"}, second)

    def test_two_accounts_on_one_endpoint_get_different_keys(self):
        self.lookup()
        self.lookup(runner=MetroCloudAlliance({"api_key": "other"}))
        keys = self.stored_keys()
        self.assertEqual(len(keys), 2)
        self.assertEqual(len({key.rsplit(":", 1)[1] for key in keys}), 2)
        self.assertTrue(all("other" not in key and "demo" not in key for key in keys))

    def test_another_process_reuses_the_stored_index_without_fetching(self):
        self.lookup()
        script = (
            "import sys\n"
            "from redash.transit_naming.suffixes import carrier_index, source_hash\n"
            "from tests.query_runner.transit_naming_fixtures import metro_suffix_profiles\n"
            "profiles = metro_suffix_profiles()\n"
            "def refuse():\n"
            "    raise SystemExit('rebuilt')\n"
            "index = carrier_index(profiles.for_carrier('MT'), profiles.revision, "
            "source_hash(sys.argv[1], 'demo'), refuse)\n"
            "print(len(index.entries))\n"
        )
        env = dict(os.environ, PYTHONPATH=os.getcwd())
        with tempfile.TemporaryDirectory() as scratch:
            path = os.path.join(scratch, "reuse.py")
            with open(path, "w") as handle:
                handle.write(script)
            done = subprocess.run(
                [sys.executable, path, self.runner.base_url], capture_output=True, text=True, env=env, cwd=os.getcwd()
            )
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertGreaterEqual(int(done.stdout.strip()), 2)


class TestCarrierWithoutTheOption(PublicResourceCase):
    IGNORED = ("normalization_revision", "gtfs_digest", "original_public_name", "suffix_completion")

    def urls(self):
        shared_corner = dict(MT_STOPS[1], carrier_code="SM", stop_id="220", uuid="uuid-sm-220")

        def every(params):
            return MT_STOPS + [shared_corner]

        return {
            "public_stops": {STOPS: stops_by_params},
            "public_stops_all": {STOPS: every},
            "public_stop_locations": {STOPS: every},
            "public_route_stops": {ROUTES: routes_by_params, STOPS: stops_by_params},
            "public_departures": {
                PREDICTIONS: [PREDICTION_STOP],
                ROUTES: routes_by_params,
                STOPS: stops_by_params,
            },
        }

    def strip(self, rows):
        return [{k: v for k, v in row.items() if k not in self.IGNORED} for row in rows]

    def test_rows_equal_the_ones_captured_before_the_option_existed(self):
        urls = self.urls()
        with open(BASELINE) as handle:
            baseline = json.load(handle)
        self.assertEqual(set(baseline), set(urls))
        for name, expected in baseline.items():
            data, _ = self.run_resource(expected["query"], urls[name])
            actual = json.loads(json.dumps(data["rows"], default=str))
            self.assertEqual(self.strip(actual), self.strip(expected["rows"]), name)

    def test_the_new_columns_repeat_the_name_and_stay_empty(self):
        data, _ = self.run_resource(
            '{"resource": "public_stops", "params": {"carrier_code": "MT"}}', self.urls()["public_stops"]
        )
        self.assertTrue(all(r["original_public_name"] == r["public_name"] for r in data["rows"]))
        self.assertTrue(all(r["suffix_completion"] == "" for r in data["rows"]))


class TestSourceHash(TestCase):
    def test_path_case_matters(self):
        self.assertNotEqual(source_hash("https://host/TenantA", "k"), source_hash("https://host/tenanta", "k"))

    def test_scheme_and_host_case_do_not_matter(self):
        self.assertEqual(source_hash("HTTPS://Host/path", "k"), source_hash("https://host/path/", "k"))

    def test_query_case_matters_and_the_key_distinguishes(self):
        self.assertNotEqual(source_hash("https://host/p?A=1", "k"), source_hash("https://host/p?a=1", "k"))
        self.assertNotEqual(source_hash("https://host/p", "k"), source_hash("https://host/p", "j"))
