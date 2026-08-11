"""
The row/column shaping seam the NTCIP runner returns its table through.

`to_typed_table` delegates to `connector_tables.to_fixed_table`, which the
TMDD runner shares. The existing NTCIP tests exercise the runner, not this
seam, so these pin the shaping itself: written and run against the
pre-extraction implementation, so the expected values are observed
behaviour rather than a restatement of the new code.
"""

from datetime import datetime
from unittest import TestCase

from redash.query_runner import TYPE_INTEGER, TYPE_STRING
from redash.query_runner.connector_tables import to_fixed_table
from redash.query_runner.ntcip_dms_rows import (
    RESOURCE_COLUMN_TYPES,
    RESOURCE_COLUMNS,
    to_typed_table,
)


class TestNtcipShaping(TestCase):
    def test_the_ntcip_shaping_is_unchanged_by_the_extraction(self):
        # to_typed_table now delegates to connector_tables.to_fixed_table. This
        # pins the three properties the extraction could plausibly have altered:
        # the declared type per column, the JSON-encoding of dict/list cells, and
        # the presence of every column on a row that carries none of them.
        rows = [
            {"device": "a", "host": "10.0.0.1", "height_mm": 900, "poll_status": "healthy"},
            {"device": "b", "host": "10.0.0.2", "poll_status": "error", "error": "timed out"},
        ]
        columns, shaped = to_typed_table("dms_identity", rows)
        self.assertEqual([c["name"] for c in columns], list(RESOURCE_COLUMNS["dms_identity"]))
        self.assertEqual({c["name"]: c["type"] for c in columns}, dict(RESOURCE_COLUMN_TYPES["dms_identity"]))
        self.assertEqual(set(shaped[1]), set(RESOURCE_COLUMNS["dms_identity"]))
        self.assertIsNone(shaped[1]["height_mm"])
        # The error row is second here on purpose: it is first-record inference
        # that this whole mechanism exists to avoid, so height_mm must still be
        # typed as an integer.
        self.assertEqual({c["name"]: c["type"] for c in columns}["height_mm"], TYPE_INTEGER)

    def test_a_list_cell_is_json_encoded(self):
        # door_open and error_status decode to a list of bit names, which the
        # columns list types as a string. The extraction has to keep that.
        rows = [{"device": "a", "host": "10.0.0.1", "door_open": ["doorOpen"], "poll_status": "healthy"}]
        _columns, shaped = to_typed_table("dms_status", rows)
        self.assertEqual(shaped[0]["door_open"], '["doorOpen"]')

    def test_a_datetime_cell_is_serialized_to_iso(self):
        # to_redash_table has always done this; the NTCIP version of the helper
        # did not, because NTCIP has no datetime column. The TMDD decoder does,
        # so the shared helper must keep the family's behaviour.
        _cols, rows = to_fixed_table(["at"], {"at": TYPE_STRING}, [{"at": datetime(2026, 8, 7, 15, 30)}])
        self.assertEqual(rows[0]["at"], "2026-08-07T15:30:00")

    def test_to_typed_table_actually_routes_through_the_shared_helper(self):
        # The three tests above all pass against the pre-extraction
        # implementation, checked by restoring it: they characterise the
        # shaping, so none of them notices if to_typed_table stops delegating
        # and NTCIP quietly forks from the helper TMDD shares.
        #
        # Datetime serialisation is the one behaviour the shared helper has
        # and the NTCIP original did not, so routing it through
        # to_typed_table, rather than calling to_fixed_table directly, is
        # what makes the delegation observable. The old code returned the
        # datetime object untouched here.
        rows = [{"device": "a", "host": "10.0.0.1", "error": datetime(2026, 8, 7, 15, 30)}]
        _columns, shaped = to_typed_table("dms_identity", rows)
        self.assertEqual(shaped[0]["error"], "2026-08-07T15:30:00")
