import os
import sqlite3
from unittest import TestCase

from redash.transit_naming.profile_loader import CORE_PROFILE_DIR

SQL_PATH = os.path.join(os.path.dirname(CORE_PROFILE_DIR), "coverage.sql")


def table(connection, name, rows):
    columns = list(rows[0])
    connection.execute(f"CREATE TABLE {name} ({', '.join(columns)})")
    connection.executemany(
        f"INSERT INTO {name} VALUES ({', '.join('?' for _ in columns)})", [tuple(r[c] for c in columns) for r in rows]
    )


class TestCoverageSql(TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        table(
            self.db,
            "query_1",
            [
                {
                    "carrier_code": "MT",
                    "route_code": "MT094",
                    "public_name_source": "gtfs",
                    "normalization_revision": "r1",
                    "gtfs_digest": "d1",
                },
                {
                    "carrier_code": "MT",
                    "route_code": "MT999",
                    "public_name_source": "passthrough",
                    "normalization_revision": "r1",
                    "gtfs_digest": "d1",
                },
            ],
        )
        table(
            self.db,
            "query_2",
            [
                {
                    "carrier_code": "MT",
                    "stop_id": "1",
                    "stop_kind": "intersection",
                    "public_name": "A/B",
                    "public_name_source": "rule",
                    "retired": 0,
                    "normalization_revision": "r1",
                    "gtfs_digest": "",
                },
                {
                    "carrier_code": "MT",
                    "stop_id": "2",
                    "stop_kind": "unparsed",
                    "public_name": "Pico \\ Rimpau",
                    "public_name_source": "passthrough",
                    "retired": 0,
                    "normalization_revision": "r1",
                    "gtfs_digest": "",
                },
                {
                    "carrier_code": "MT",
                    "stop_id": "3",
                    "stop_kind": "intersection",
                    "public_name": "C & D",
                    "public_name_source": "rule",
                    "retired": 1,
                    "normalization_revision": "r1",
                    "gtfs_digest": "",
                },
            ],
        )
        table(
            self.db,
            "query_3",
            [
                {
                    "carrier_code": "MT",
                    "route_code": "MT094",
                    "direction": "N",
                    "stop_match": "id",
                    "sequence_source": "gtfs_stop_times",
                    "normalization_revision": "r1",
                    "gtfs_digest": "d2",
                },
                {
                    "carrier_code": "MT",
                    "route_code": "MT094",
                    "direction": "N",
                    "stop_match": "unmatched",
                    "sequence_source": "gtfs_stop_times",
                    "normalization_revision": "r1",
                    "gtfs_digest": "d2",
                },
            ],
        )
        table(
            self.db,
            "query_4",
            [
                {
                    "carrier": "MT",
                    "public_route_name_source": "rule",
                    "public_stop_name_source": "gtfs",
                    "normalization_revision": "r1",
                    "gtfs_digest": "d1",
                },
            ],
        )
        with open(SQL_PATH, encoding="utf-8") as handle:
            self.sql = handle.read().format(
                routes="query_1", stops="query_2", route_stops="query_3", departures="query_4"
            )

    def metrics(self):
        return {(m, d): v for _, m, d, v, _, _ in self.db.execute(self.sql).fetchall()}

    def test_counts_by_source_kind_and_match(self):
        got = self.metrics()
        self.assertEqual(got[("routes_by_source", "gtfs")], 1)
        self.assertEqual(got[("routes_by_source", "passthrough")], 1)
        self.assertEqual(got[("stops_by_kind", "intersection")], 2)
        self.assertEqual(got[("stops_by_source", "passthrough")], 1)
        self.assertEqual(got[("route_stops_by_match", "unmatched")], 1)
        self.assertEqual(got[("stops_retired", "true")], 1)

    def test_lists_the_rows_that_need_overrides(self):
        got = self.metrics()
        self.assertEqual(got[("unparsed_stop", "2")], "Pico \\ Rimpau")
        self.assertEqual(got[("intersection_with_ampersand", "3")], "C & D")
        self.assertEqual(got[("route_passthrough", "MT999")], "MT999")

    def test_routes_with_no_pattern_and_digest_disagreement(self):
        got = self.metrics()
        self.assertEqual(got[("route_without_pattern", "MT999")], "MT999")
        self.assertEqual(got[("digest_disagreement", "routes")], "d1")
        self.assertEqual(got[("digest_disagreement", "route_stops")], "d2")
        self.assertEqual(got[("departures_route_source", "rule")], 1)


def lineage(carrier, **fields):
    return {"carrier_code": carrier, "normalization_revision": "r1", **fields}


class TestCoverageReviewFindings(TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        table(
            self.db,
            "query_1",
            [
                lineage("BU", route_code="BUORA", public_name_source="rule", gtfs_digest=""),
                lineage("MT", route_code="MT094", public_name_source="gtfs", gtfs_digest="d1"),
            ],
        )
        table(
            self.db,
            "query_2",
            [
                lineage(
                    "MT",
                    stop_id="1",
                    stop_kind="intersection",
                    public_name="A/B",
                    public_name_source="rule",
                    retired=0,
                    gtfs_digest="",
                )
            ],
        )
        table(
            self.db,
            "query_3",
            [
                lineage(
                    "MT",
                    route_code="MT094",
                    direction="N",
                    stop_match="id",
                    sequence_source="gtfs_stop_times",
                    gtfs_digest="d1",
                )
            ],
        )
        table(
            self.db,
            "query_4",
            [
                {
                    "carrier": "MT",
                    "public_route_name_source": "gtfs",
                    "public_stop_name_source": "rule",
                    "normalization_revision": "r1",
                    "gtfs_digest": "d3",
                }
            ],
        )
        with open(SQL_PATH, encoding="utf-8") as handle:
            self.sql = handle.read().format(
                routes="query_1", stops="query_2", route_stops="query_3", departures="query_4"
            )

    def test_feedless_carrier_and_departures_drift_are_reported(self):
        got = {(c, m, d): v for c, m, d, v, _, _ in self.db.execute(self.sql).fetchall()}
        self.assertEqual(got[("BU", "gtfs", "none")], 1)
        self.assertEqual(got[("MT", "digest_disagreement", "departures")], "d3")
        self.assertNotIn(("MT", "gtfs", "none"), got)
