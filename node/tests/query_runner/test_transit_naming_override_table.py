from unittest import TestCase
from unittest.mock import patch

from redash.transit_naming import provenance
from redash.transit_naming.override_table import OverrideTable, read_overrides
from redash.transit_naming.profile_loader import CORE_PROFILE_DIR, build_profile_set
from redash.transit_naming.routes import name_route
from redash.transit_naming.stops import name_stop
from redash.transit_naming.suffixes import CarrierIndexes
from tests.query_runner.transit_naming_fixtures import metro_profile


class FakeClient:
    def __init__(self, rows=None, error=None):
        self.rows = rows or []
        self.error = error
        self.queries = []

    def query_json(self, query):
        self.queries.append(query)
        if self.error:
            raise self.error
        return {"meta": [], "data": self.rows}


def row(kind, carrier, target, name, note="", captured_at="2026-10-23 10:00:00"):
    return {
        "kind": kind,
        "carrier_code": carrier,
        "target_id": target,
        "public_name": name,
        "note": note,
        "captured_at": captured_at,
    }


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def profiles_with(rows):
    return build_profile_set([CORE_PROFILE_DIR]).with_overrides(read_overrides(FakeClient(rows), "historical.x"))


class TestReadOverrides(TestCase):
    def test_rows_become_overrides_per_carrier(self):
        overrides = read_overrides(
            FakeClient([row("stop", "MT", "1166", "1st St/Main St"), row("route", "MT", "MT720", "Rapid 720")]),
            "historical.stop_name_overrides",
        )
        self.assertEqual(overrides["MT"][("stop", "1166")].public_name, "1st St/Main St")
        self.assertEqual(overrides["MT"][("route", "MT720")].public_name, "Rapid 720")

    def test_the_latest_row_for_one_target_wins(self):
        overrides = read_overrides(
            FakeClient(
                [
                    row("stop", "MT", "1", "Newer", captured_at="2026-10-23 11:00:00"),
                    row("stop", "MT", "1", "Older", captured_at="2026-10-23 09:00:00"),
                ]
            ),
            "historical.x",
        )
        self.assertEqual(overrides["MT"][("stop", "1")].public_name, "Newer")

    def test_unusable_rows_are_skipped(self):
        overrides = read_overrides(
            FakeClient(
                [
                    row("location", "MT", "1001", "Not editable here"),
                    row("stop", "", "1", "No carrier"),
                    row("stop", "MT", " ", "No target"),
                    row("stop", "MT", "2", "  "),
                    row(" Stop ", " mt ", " 3 ", " Trimmed "),
                ]
            ),
            "historical.x",
        )
        self.assertEqual(list(overrides), ["MT"])
        self.assertEqual(list(overrides["MT"]), [("stop", "3")])
        self.assertEqual(overrides["MT"][("stop", "3")].public_name, "Trimmed")

    def test_a_table_name_that_is_not_database_dot_table_is_refused(self):
        for table in ("x", "historical.x; DROP TABLE y", "historical.x.y", "1db.x"):
            with self.assertRaises(ValueError, msg=table):
                read_overrides(FakeClient(), table)


class TestOverridesReachTheNames(TestCase):
    def test_a_stop_override_names_the_stop(self):
        profiles = profiles_with([row("stop", "MT", "1166", "Main St/1st St")])
        stop = {"stop_id": "1166", "stop_name": "1st St/Main St", "transit_modes": "BUS", "prediction_count": 1}
        name = name_stop(stop, profiles.for_carrier("MT", "Metro"))
        self.assertEqual((name.public_name, name.public_name_source), ("Main St/1st St", provenance.OVERRIDE))

    def test_a_route_override_names_the_route(self):
        profiles = profiles_with([row("route", "MT", "MT720", "Elmwood Rapid")])
        route = {"carrier_code": "MT", "route_code": "MT720", "route_name": "720", "line_color": ""}
        name = name_route(route, profiles.for_carrier("MT", "Metro"), None)
        self.assertEqual((name.public_name, name.public_name_source), ("Elmwood Rapid", provenance.OVERRIDE))

    def test_a_table_row_beats_a_profile_file_row(self):
        metro = metro_profile()
        profiles = build_profile_set([CORE_PROFILE_DIR]).with_overrides(
            read_overrides(FakeClient([row("stop", "MT", "3000001", "Pico Bl/Rimpau Bl")]), "historical.x")
        )
        merged = profiles.merged_overrides(metro)
        self.assertEqual(merged.override_for("stop", "3000001").public_name, "Pico Bl/Rimpau Bl")

    def test_overrides_change_the_revision(self):
        plain = build_profile_set([CORE_PROFILE_DIR])
        self.assertEqual(plain.with_overrides({}).revision, plain.revision)
        self.assertNotEqual(profiles_with([row("stop", "MT", "1", "A")]).revision, plain.revision)
        self.assertNotEqual(
            profiles_with([row("stop", "MT", "1", "A")]).revision,
            profiles_with([row("stop", "MT", "1", "B")]).revision,
        )


class TestOverrideTable(TestCase):
    def test_unset_reads_nothing(self):
        client = FakeClient([row("stop", "MT", "1", "A")])
        self.assertEqual(OverrideTable("", client).current(), {})
        self.assertEqual(client.queries, [])

    def test_reads_are_cached_for_the_ttl(self):
        client, clock = FakeClient([row("stop", "MT", "1", "A")]), Clock()
        table = OverrideTable("historical.x", client, ttl_seconds=60, clock=clock)
        table.current()
        clock.now += 59
        table.current()
        self.assertEqual(len(client.queries), 1)
        clock.now += 2
        table.current()
        self.assertEqual(len(client.queries), 2)

    def test_a_failed_read_keeps_the_last_good_overrides(self):
        client, clock = FakeClient([row("stop", "MT", "1", "A")]), Clock()
        table = OverrideTable("historical.x", client, ttl_seconds=60, clock=clock)
        self.assertIn("MT", table.current())
        client.error = Exception("connection refused")
        clock.now += 61
        with self.assertLogs("redash.transit_naming.override_table", level="WARNING"):
            self.assertIn("MT", table.current())

    def test_a_first_read_that_fails_names_nothing(self):
        table = OverrideTable("historical.x", FakeClient(error=Exception("down")), ttl_seconds=60, clock=Clock())
        with self.assertLogs("redash.transit_naming.override_table", level="WARNING"):
            self.assertEqual(table.current(), {})


class TestSuffixIndexKeys(TestCase):
    def keys(self, rows):
        profiles = profiles_with(rows)
        indexes = CarrierIndexes(profiles.base_revision, "source", lambda carrier: [], profiles.extra_overrides)
        seen = {}
        with patch("redash.transit_naming.suffixes.carrier_index", lambda profile, revision, *_: revision):
            for carrier in ("MT", "OC"):
                seen[carrier] = indexes.get(profiles.for_carrier(carrier))
        return seen

    def test_only_a_stop_override_moves_its_own_carrier_index(self):
        plain = self.keys([])
        self.assertEqual(self.keys([row("route", "MT", "MT720", "Rapid")]), plain)
        moved = self.keys([row("stop", "MT", "1", "A")])
        self.assertNotEqual(moved["MT"], plain["MT"])
        self.assertEqual(moved["OC"], plain["OC"])
