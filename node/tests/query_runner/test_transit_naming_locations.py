from unittest import TestCase

from redash.transit_naming import provenance
from redash.transit_naming.locations import LOCATION_COLUMNS, location_rows
from redash.transit_naming.profile_loader import CORE_PROFILE_DIR, build_profile_set
from tests.query_runner.transit_naming_fixtures import MT_CSV, MT_YAML, metro_profiles


def member(carrier, stop_id, name, id511="1000001", kind="intersection", retired=False, lat=34.0, lng=-118.0):
    return {
        "carrier_code": carrier,
        "stop_id": stop_id,
        "511_id": id511,
        "public_name": name,
        "stop_kind": kind,
        "retired": retired,
        "lat": lat,
        "lng": lng,
        "normalization_revision": "r1",
    }


class TestLocationRows(TestCase):
    def setUp(self):
        self.profiles = metro_profiles()

    def rows(self, members, **params):
        return location_rows(members, self.profiles, params)

    def test_the_name_most_members_share_wins(self):
        rows = self.rows(
            [
                member("SM", "220", "Victory Bl/De Soto Av"),
                member("BB", "9", "Victory Bl/De Soto Av"),
                member("MT", "997", "Victory/De Soto"),
            ]
        )
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual((row["511_id"], row["public_name"]), ("1000001", "Victory Bl/De Soto Av"))
        self.assertEqual((row["public_name_source"], row["agreeing_stops"], row["source_stops"]), ("consensus", 2, 3))
        self.assertEqual((row["chosen_carrier"], row["chosen_stop_id"]), ("BB", "9"))
        self.assertEqual(row["carriers"], 3)
        self.assertEqual(row["source_stop_ids"], "BB 9, MT 997, SM 220")
        self.assertEqual(row["names"], "Victory Bl/De Soto Av; Victory/De Soto")

    def test_a_tie_prefers_a_station_then_a_curated_carrier_then_the_carrier_code(self):
        rows = self.rows(
            [
                member("SC", "288", "Railroad Av/Newhall Station", kind="intersection"),
                member("AM", "NHL", "Santa Clarita-Newhall Amtrak Station", kind="station"),
            ]
        )
        self.assertEqual(
            (rows[0]["public_name"], rows[0]["public_name_source"]),
            ("Santa Clarita-Newhall Amtrak Station", "tiebreak"),
        )
        rows = self.rows([member("SM", "220", "Ocean/Colorado"), member("MT", "997", "Ocean Av/Colorado Av")])
        self.assertEqual(rows[0]["chosen_carrier"], "MT")
        rows = self.rows([member("SM", "220", "Ocean/Colorado"), member("BB", "9", "Ocean Av/Colorado Av")])
        self.assertEqual(rows[0]["chosen_carrier"], "BB")

    def test_a_location_override_beats_consensus(self):
        csv = MT_CSV + "location,1000001,Victory/De Soto,the corner's sign\n"
        profiles = build_profile_set([CORE_PROFILE_DIR], extra_files={"/pack": {"MT.yaml": MT_YAML, "MT.csv": csv}})
        rows = location_rows(
            [
                member("SM", "220", "Victory Bl/De Soto Av"),
                member("BB", "9", "Victory Bl/De Soto Av"),
                member("MT", "997", "Victory Bl/De Soto Av"),
            ],
            profiles,
            {},
        )
        self.assertEqual(
            (rows[0]["public_name"], rows[0]["public_name_source"]), ("Victory/De Soto", provenance.OVERRIDE)
        )

    def test_stops_without_a_511_id_are_left_out_and_a_filter_keeps_one_location(self):
        members = [
            member("MT", "1", "A/B", id511="1000001"),
            member("MT", "2", "C/D", id511="1000002"),
            member("MT", "3", "E/F", id511=None),
            member("MT", "4", "G/H", id511=""),
        ]
        self.assertEqual([r["511_id"] for r in self.rows(members)], ["1000001", "1000002"])
        self.assertEqual([r["511_id"] for r in self.rows(members, stop_511_id="1000002")], ["1000002"])

    def test_coordinates_average_the_active_members_and_retired_are_counted(self):
        rows = self.rows(
            [
                member("MT", "1", "A/B", lat=34.0, lng=-118.0),
                member("SM", "2", "A/B", lat=34.2, lng=-118.2),
                member("BB", "3", "A/B", lat=0.0, lng=0.0, retired=True),
            ]
        )
        self.assertEqual((rows[0]["lat"], rows[0]["lng"], rows[0]["retired_stops"]), (34.1, -118.1, 1))

    def test_rows_carry_the_declared_columns_in_order(self):
        rows = self.rows([member("MT", "1", "A/B")])
        self.assertEqual(list(rows[0]), list(LOCATION_COLUMNS))
