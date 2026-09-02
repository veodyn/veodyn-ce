import tempfile
from unittest import TestCase
from unittest.mock import Mock, patch

from redash.query_runner import metrocloudalliance_public as public
from redash.query_runner.metrocloudalliance import MetroCloudAlliance
from redash.transit_naming.profile_loader import CORE_PROFILE_DIR, build_profile_set
from tests.query_runner.transit_naming_fixtures import (
    MT_ROUTES,
    MT_STOPS,
    MT_STOPS_BY_ID,
    MT_YAML,
    PREDICTION_STOP,
    STOP_LOOKUP_1166,
    mca_route,
    metro_profiles,
)
from tests.query_runner.transit_naming_gtfs_fixtures import (
    BUS_MEMBERS,
    BUS_URL,
    RAIL_MEMBERS,
    RAIL_ROUTES_TXT,
    RAIL_STOP_TIMES_TXT,
    RAIL_TRIPS_TXT,
    RAIL_URL,
    archive_fetcher,
    build_archive,
    metro_archives,
)

PREDICTIONS = "https://api.metrocloudalliance.com/v2/realtime/predictions"
ROUTES = "https://api.metrocloudalliance.com/v2/transitnetwork/routes"
STOPS = "https://api.metrocloudalliance.com/v2/transitnetwork/stops"


def responder(by_url):
    def get(url, params=None, timeout=None):
        payload = by_url[url](params or {}) if callable(by_url[url]) else by_url[url]
        response = Mock()
        response.json.return_value = {"status": "ok", "results": payload}
        response.raise_for_status.return_value = None
        return response

    return get


def stops_by_params(params):
    if params.get("stop_id"):
        return [STOP_LOOKUP_1166] if params["stop_id"] == "1166" else []
    if params.get("pattern_code"):
        return [dict(MT_STOPS_BY_ID["1166"], pattern_code=params["pattern_code"])]
    return MT_STOPS


ALL_ROUTES = MT_ROUTES + [mca_route("MT999", "999", 99, 99)]


def routes_by_params(params):
    if params.get("route_code"):
        return [r for r in ALL_ROUTES if r["route_code"] == params["route_code"]]
    return ALL_ROUTES


class PublicResourceCase(TestCase):
    def setUp(self):
        self.cache = tempfile.TemporaryDirectory()
        patches = [
            patch.object(public, "load_profile_set", return_value=metro_profiles()),
            patch.object(public, "cache_dir", return_value=self.cache.name),
            patch.object(public, "archive_fetch", metro_archives()),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.cache.cleanup)
        self.runner = MetroCloudAlliance({"api_key": "demo"})

    def run_resource(self, query, by_url):
        with patch("redash.query_runner.metrocloudalliance.requests.get", side_effect=responder(by_url)) as get:
            data, error = self.runner.run_query(query, None)
        self.assertIsNone(error, error)
        return data, get


class TestPublicRoutes(PublicResourceCase):
    def test_hits_routes_and_returns_named_rows(self):
        data, get = self.run_resource(
            '{"resource": "public_routes", "params": {"carrier_code": "MT"}}', {ROUTES: routes_by_params}
        )
        self.assertEqual(get.call_args.args[0], ROUTES)
        by_code = {r["route_code"]: r for r in data["rows"]}
        self.assertEqual(by_code["MT094"]["public_name"], "Metro Local Line 94")
        self.assertEqual(by_code["MT950"]["public_name_source"], "alias")
        self.assertEqual(by_code["MT022"]["public_name"], "South Bay Dodger Stadium Express")
        self.assertEqual(by_code["MT801"]["public_name"], "Metro A Line (Blue)")
        self.assertEqual(len(by_code["MT094"]["gtfs_digest"]), 64)
        self.assertTrue(by_code["MT094"]["normalization_revision"].startswith("2026."))

    def test_carrier_code_is_required(self):
        with patch("redash.query_runner.metrocloudalliance.requests.get") as get:
            data, error = self.runner.run_query('{"resource": "public_routes"}', None)
        self.assertIn("'carrier_code' param is required", error)
        get.assert_not_called()


class TestPublicStops(PublicResourceCase):
    def test_hits_stops_and_names_them(self):
        data, get = self.run_resource(
            '{"resource": "public_stops", "params": {"carrier_code": "MT"}}', {STOPS: stops_by_params}
        )
        by_id = {r["stop_id"]: r for r in data["rows"]}
        self.assertEqual(by_id["1"]["public_name"], "Paramount Bl/Slauson Av")
        self.assertEqual(by_id["3000001"]["public_name_source"], "override")
        self.assertTrue(by_id["10270"]["retired"])
        self.assertEqual(by_id["80122"]["stop_kind"], "station")


class TestPublicRouteStops(PublicResourceCase):
    def test_orders_stops_from_gtfs(self):
        data, get = self.run_resource(
            '{"resource": "public_route_stops", "params": {"carrier_code": "MT", "route_code": "MT030"}}',
            {ROUTES: routes_by_params, STOPS: stops_by_params},
        )
        east = [r for r in data["rows"] if r["direction"] == "E"]
        self.assertEqual([r["stop_id"] for r in east], ["3000001", "13574", "19022", "1166"])
        self.assertEqual(east[0]["public_name"], "Pico/Rimpau")
        self.assertEqual({r["sequence_source"] for r in data["rows"]}, {"gtfs_stop_times"})

    def test_retired_stops_are_excluded(self):
        data, _ = self.run_resource(
            '{"resource": "public_route_stops", "params": {"carrier_code": "MT"}}',
            {ROUTES: routes_by_params, STOPS: stops_by_params},
        )
        self.assertNotIn("10270", {r["stop_id"] for r in data["rows"]})

    def test_feedless_route_falls_back_to_pattern_membership(self):
        with_pattern = build_profile_set(
            [CORE_PROFILE_DIR],
            extra_files={
                "/pack": {"MT.yaml": MT_YAML.replace("pattern_codes: {}", 'pattern_codes: {MT999: ["MT999 N"]}')}
            },
        )
        with patch.object(public, "load_profile_set", return_value=with_pattern):
            data, get = self.run_resource(
                '{"resource": "public_route_stops", "params": {"carrier_code": "MT", "route_code": "MT999"}}',
                {ROUTES: routes_by_params, STOPS: stops_by_params},
            )
        self.assertEqual(
            [(r["stop_id"], r["sequence"], r["sequence_source"], r["pattern_id"]) for r in data["rows"]],
            [("1166", None, "mca_pattern", "MT999 N")],
        )
        self.assertEqual(get.call_args_list[-1].kwargs["params"]["pattern_code"], "MT999 N")


class TestPublicDepartures(PublicResourceCase):
    def test_three_fetches_and_public_columns(self):
        data, get = self.run_resource(
            '{"resource": "public_departures", "params": {"carrier_code": "MT", "stop_id": "1166"}}',
            {PREDICTIONS: [PREDICTION_STOP], ROUTES: routes_by_params, STOPS: stops_by_params},
        )
        urls = [call.args[0] for call in get.call_args_list]
        self.assertEqual(urls, [PREDICTIONS, ROUTES, STOPS])
        self.assertEqual(get.call_args_list[2].kwargs["params"]["stop_id"], "1166")
        row = [r for r in data["rows"] if r["raw_route"] == "30"][0]
        self.assertEqual(
            (row["public_route_name"], row["public_stop_name"]), ("Metro Local Line 30", "1st St/Main St")
        )
        self.assertEqual(row["public_route_name_source"], "gtfs")
        names = [c["name"] for c in data["columns"]]
        self.assertIn("departure_at", names)
        self.assertNotIn("route", names)


class TestNamingProfiles(PublicResourceCase):
    def test_lists_loaded_profiles(self):
        with patch("redash.query_runner.metrocloudalliance.requests.get") as get:
            data, error = self.runner.run_query('{"resource": "naming_profiles"}', None)
        get.assert_not_called()
        self.assertIsNone(error)
        rows = {r["carrier_code"]: r for r in data["rows"]}
        self.assertEqual(sorted(rows), ["MT", "default"])
        self.assertEqual(rows["MT"]["overrides"], 2)
        self.assertTrue(rows["MT"]["source_file"].endswith("MT.yaml"))
        self.assertEqual(rows["MT"]["revision"], rows["default"]["revision"])


class TestReviewFindings(PublicResourceCase):
    def test_empty_departures_keep_their_columns(self):
        query = '{"resource": "public_departures", "params": {"carrier_code": "MT", "stop_id": "1166"}}'
        data, _ = self.run_resource(query, {PREDICTIONS: [], ROUTES: routes_by_params, STOPS: stops_by_params})
        names = [c["name"] for c in data["columns"]]
        self.assertEqual(data["rows"], [])
        self.assertIn("departure_at", names)
        self.assertIn("public_route_name", names)

    def test_empty_routes_keep_their_columns(self):
        query = '{"resource": "public_routes", "params": {"carrier_code": "MT", "route_code": "MT000"}}'
        data, _ = self.run_resource(query, {ROUTES: routes_by_params})
        self.assertEqual(data["rows"], [])
        self.assertEqual([c["name"] for c in data["columns"]][:3], ["carrier_code", "carrier_id", "carrier_name"])

    def test_archive_fetch_carries_the_runner_timeout(self):
        runner = MetroCloudAlliance({"api_key": "demo", "request_timeout": 7})
        self.assertEqual(runner._archive_fetcher().keywords, {"timeout": 7})

    def test_patterns_come_from_the_resolved_source(self):
        rail_members = dict(
            RAIL_MEMBERS,
            **{
                "routes.txt": RAIL_ROUTES_TXT + "910-13201,,Rail J,,3,ADB8BF,000000\n",
                "trips.txt": RAIL_TRIPS_TXT + "910-13201,WD,r910a,,0,1,910NB\n",
                "stop_times.txt": RAIL_STOP_TIMES_TXT
                + "r910a,05:00:00,05:00:00,80101,1\nr910a,05:03:00,05:03:00,80102,2\n",
            },
        )
        fetch = archive_fetcher({BUS_URL: build_archive(BUS_MEMBERS), RAIL_URL: build_archive(rail_members)})
        aliased = MT_YAML.replace("MT950: {source: bus,", "MT950: {source: rail,")
        profiles = build_profile_set([CORE_PROFILE_DIR], extra_files={"/pack": {"MT.yaml": aliased}})
        query = '{"resource": "public_route_stops", "params": {"carrier_code": "MT", "route_code": "MT950"}}'
        with patch.object(public, "load_profile_set", return_value=profiles), patch.object(
            public, "archive_fetch", fetch
        ):
            data, _ = self.run_resource(query, {ROUTES: routes_by_params, STOPS: stops_by_params})
        self.assertEqual([r["stop_id"] for r in data["rows"]], ["80101", "80102"])
