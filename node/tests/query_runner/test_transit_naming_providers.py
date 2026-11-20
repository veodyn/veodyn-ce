from unittest.mock import patch

from redash.query_runner import metrocloudalliance_public as public
from redash.transit_naming.profile_loader import CORE_PROFILE_DIR, build_profile_set
from tests.query_runner.test_metrocloudalliance_public import (
    ROUTES,
    PublicResourceCase,
    routes_by_params,
)
from tests.query_runner.transit_naming_fixtures import MT_CSV, MT_YAML

CARRIERS = "https://api.metrocloudalliance.com/v2/transitnetwork/carriers"
NAMED_PROVIDER = MT_YAML.replace(
    "carrier_display_name: Metro\n", "carrier_display_name: Metro\nprovider_name: Zed Metro\n"
)


def profiles_with_provider():
    files = {"MT.yaml": NAMED_PROVIDER, "MT.csv": MT_CSV}
    return build_profile_set([CORE_PROFILE_DIR], extra_files={"/pack/naming_profiles": files})


def carriers(params):
    return [
        {"carrier_code": "MT", "carrier_name": "Metro"},
        {"carrier_code": "QV", "carrier_name": "Quarry Valley Shuttle"},
    ]


class TestRouteGroups(PublicResourceCase):
    def rows(self):
        data, _ = self.run_resource(
            '{"resource": "public_routes", "params": {"carrier_code": "MT"}}', {ROUTES: routes_by_params}
        )
        return {r["route_code"]: r for r in data["rows"]}

    def test_routes_on_one_gtfs_route_under_one_name_are_one_line(self):
        rows = self.rows()
        self.assertEqual((rows["MT910"]["route_group"], rows["MT950"]["route_group"]), ("MT910", "MT910"))

    def test_every_other_route_is_its_own_line(self):
        rows = self.rows()
        self.assertEqual(rows["MT720"]["route_group"], "MT720")
        self.assertEqual(rows["MT236"]["route_group"], "MT236")
        self.assertEqual((rows["MT009"]["route_group"], rows["MT022"]["route_group"]), ("MT009", "MT022"))

    def test_without_a_profile_provider_name_the_mca_name_is_the_provider(self):
        self.assertEqual({r["provider_name"] for r in self.rows().values()}, {"Metro"})


class TestProviderNames(PublicResourceCase):
    def run_with(self, profiles, query):
        with patch.object(public, "load_profile_set", return_value=profiles):
            data, _ = self.run_resource(query, {ROUTES: routes_by_params, CARRIERS: carriers})
        return data

    def test_the_profile_names_the_provider_on_its_routes(self):
        data = self.run_with(
            profiles_with_provider(), '{"resource": "public_routes", "params": {"carrier_code": "MT"}}'
        )
        rows = {r["route_code"]: r for r in data["rows"]}
        self.assertEqual((rows["MT094"]["provider_name"], rows["MT094"]["carrier_name"]), ("Zed Metro", "Metro"))

    def test_the_provider_name_does_not_rename_routes(self):
        data = self.run_with(
            profiles_with_provider(), '{"resource": "public_routes", "params": {"carrier_code": "MT"}}'
        )
        rows = {r["route_code"]: r for r in data["rows"]}
        self.assertEqual(rows["MT094"]["public_name"], "Metro Local Line 94")

    def test_carriers_list_each_provider_under_its_rider_facing_name(self):
        data = self.run_with(profiles_with_provider(), '{"resource": "public_carriers"}')
        names = {r["carrier_code"]: (r["carrier_name"], r["provider_name"]) for r in data["rows"]}
        self.assertEqual(
            names, {"MT": ("Metro", "Zed Metro"), "QV": ("Quarry Valley Shuttle", "Quarry Valley Shuttle")}
        )

    def test_carriers_is_a_documented_resource_with_columns(self):
        data = self.run_with(profiles_with_provider(), '{"resource": "public_carriers"}')
        self.assertIn("provider_name", [c["name"] for c in data["columns"]])
