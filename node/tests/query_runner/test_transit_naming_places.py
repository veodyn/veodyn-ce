from unittest.mock import patch

from redash.query_runner import metrocloudalliance_public as public
from redash.transit_naming.profile_loader import CORE_PROFILE_DIR, build_profile_set
from tests.query_runner.test_metrocloudalliance_public import STOPS, PublicResourceCase
from tests.query_runner.transit_naming_fixtures import MT_CSV, MT_YAML, mca_stop

CARRIERS = "https://api.metrocloudalliance.com/v2/transitnetwork/carriers"


def stop(carrier, stop_id, name, id511, modes="BUS", predictions=1, lat=34.1, lng=-118.1, on="", cross=""):
    row = dict(
        mca_stop(stop_id, name, lat, lng, on=on, cross=cross, modes=modes, predictions=predictions),
        carrier_code=carrier,
    )
    row["511_id"] = id511
    return row


METERS = 1 / 111_000


def members(value):
    return {
        f"{group.split(':')[0]}:{stop_id}" for group in value.split(",") for stop_id in group.split(":")[1].split("|")
    }


STOPS_AT_PLACES = [
    stop("ZT", "7", "Alder Hub", "9001"),
    stop("QV", "12", "Alder Hub", "9001"),
    stop("QV", "13", "Alder Hub", "9001", modes="", predictions=0),
    stop("ZT", "44", "Birch Rd/Cedar Av", "", lat=34.3),
    stop("ZT", "61", "Elm Station - Lower Level", "9101", lat=34.2),
    stop("QV", "62", "Elm Station", "", lat=34.2 + 60 * METERS),
    stop("QV", "63", "Elm Station Upper Level", "", lat=34.2 + 70 * METERS),
    stop("RL", "64", "Elm Station", "9102", modes="RAIL", lat=34.2 + 700 * METERS),
    stop("ZT", "71", "Oak Av/Pine St", "9201", lat=34.4, on="Oak Av", cross="Pine St"),
    stop("QV", "72", "Oak Av/Pine St", "9202", lat=34.4 + 5 * METERS, on="Oak Av", cross="Pine St"),
]


def carriers(params):
    return [
        {"carrier_code": "ZT", "carrier_name": "Zed Transit"},
        {"carrier_code": "QV", "carrier_name": "Quarry Valley Shuttle"},
        {"carrier_code": "RL", "carrier_name": "Ridge Line Rail"},
    ]


def profiles_naming_zt():
    zt = MT_YAML.replace("carrier_code: MT\n", "carrier_code: ZT\n", 1).replace(
        "carrier_display_name: Metro\n", "carrier_display_name: Zed\nprovider_name: Zed Lines\n", 1
    )
    return build_profile_set(
        [CORE_PROFILE_DIR],
        extra_files={"/pack/naming_profiles": {"ZT.yaml": zt, "MT.yaml": MT_YAML, "MT.csv": MT_CSV}},
    )


class TestPublicPlaces(PublicResourceCase):
    def rows(self, profiles=None, stops=None):
        with patch.object(public, "load_profile_set", return_value=profiles or public.load_profile_set()):
            data, _ = self.run_resource(
                '{"resource": "public_places"}', {STOPS: lambda params: stops or STOPS_AT_PLACES, CARRIERS: carriers}
            )
        return {row["place"]: row for row in data["rows"]}, data

    def test_stops_sharing_a_511_id_are_one_place_valued_by_their_member_stops(self):
        rows, _ = self.rows()
        self.assertEqual(rows["9001"]["value"], "QV:12|13,ZT:7")
        self.assertEqual(rows["9001"]["member_stops"], rows["9001"]["value"])

    def test_a_stop_without_a_511_id_is_its_own_place(self):
        rows, _ = self.rows()
        self.assertEqual((rows["ZT:44"]["value"], rows["ZT:44"]["provider_stop_ids"]), ("ZT:44", "44"))

    def test_providers_are_named_for_riders(self):
        rows, _ = self.rows(profiles_naming_zt())
        self.assertEqual(rows["9001"]["providers"], "Quarry Valley Shuttle, Zed Lines")
        self.assertEqual(rows["9001"]["name"], f"{rows['9001']['public_name']} (Quarry Valley Shuttle, Zed Lines)")

    def test_retired_members_stay_in_the_place(self):
        rows, _ = self.rows()
        self.assertIn("QV:13", members(rows["9001"]["value"]))

    def test_no_value_exceeds_the_public_parameter_limit(self):
        rows, _ = self.rows()
        self.assertTrue(all(len(row["value"]) <= 200 for row in rows.values()))

    def test_value_is_the_first_column_for_a_dropdown(self):
        _, data = self.rows()
        self.assertEqual([c["name"] for c in data["columns"]][:2], ["value", "name"])

    def test_a_stations_stops_from_several_providers_are_one_place(self):
        rows, _ = self.rows()
        self.assertEqual(rows["9101"]["value"], "QV:62|63,ZT:61")
        self.assertEqual(rows["9101"]["public_name"], "Elm Station")
        self.assertEqual(set(rows["9101"]["keys"].split(";")), {"9101", "QV:62", "QV:63"})

    def test_a_same_named_station_far_away_stays_its_own_place(self):
        rows, _ = self.rows()
        self.assertEqual(rows["9102"]["value"], "RL:64")

    def test_merge_candidates_join_two_providers_stops_at_one_corner(self):
        rows, _ = self.rows()
        self.assertEqual((rows["9201"]["value"], rows["9201"]["keys"]), ("QV:72,ZT:71", "9201;9202"))
        self.assertNotIn("9202", rows)

    def test_a_huge_place_is_cut_to_fit_the_public_parameter(self):
        many = [stop("ZT", str(1000000 + n), "Fir Transit Center Bay", "9301") for n in range(45)]
        rows, _ = self.rows(stops=many)
        value = rows["9301"]["value"]
        self.assertLessEqual(len(value), 200)
        self.assertLessEqual(len(value.split(":")[1].split("|")), 40)
