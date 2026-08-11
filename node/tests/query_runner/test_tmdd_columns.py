"""
The column set and the column TYPES the TMDD runner declares, as literals.

Split out of test_tmdd_decode for the repo's 300-line limit, along a seam
worth having on its own: this is the only module that may write these
expectations down, and everything else imports them from here rather than
restating them or, worse, deriving them from the tables under test.

Both halves are written out by hand. Comparing `RESOURCE_COLUMNS` to itself
passes for a column missing from both sides, which is the shared-omission
defect this codebase has shipped before, and `RESOURCE_COLUMN_TYPES` had the
same hole one level down: test_tmdd_decode pinned the type map's KEYS and
test_tmdd_records compared the emitted types to the same dictionary that
emitted them, so nothing anywhere pinned a type VALUE. Retyping `beacon_on`
to a string, or the coordinates to strings, changed how Redash filters and
charts those columns and left the whole suite green.
"""

import unittest

from redash.query_runner import (
    TYPE_BOOLEAN,
    TYPE_DATETIME,
    TYPE_FLOAT,
    TYPE_INTEGER,
    TYPE_STRING,
)
from redash.query_runner.tmdd_rows import RESOURCE_COLUMN_TYPES, RESOURCE_COLUMNS

EXPECTED_COLUMNS = {
    "dms_inventory": [
        "device_id",
        "device_name",
        "device_type",
        "roadway",
        "direction",
        "latitude",
        "longitude",
        "latitude_raw",
        "longitude_raw",
    ],
    "dms_status": ["device_id", "oper_status", "current_message", "beacon_on", "last_update"],
    "events": [
        "event_id",
        "event_type",
        "event_type_code",
        "severity",
        "status",
        "description",
        "descriptions",
        "locations",
        "update_times",
        "roadway",
        "direction",
        "latitude",
        "longitude",
        "latitude_raw",
        "longitude_raw",
        "start_time",
        "update_time",
    ],
}

# The Redash type constants are imported rather than spelled as their string
# values, because the constant is the contract: a column typed "boolean" is
# filtered, charted and serialised differently from one typed "string", and
# that is the difference these literals exist to hold still. The coordinate
# pair is written out per resource rather than shared through a helper, for
# the same reason the lists above are: a shared spread is one place to get
# both resources wrong at once.
EXPECTED_COLUMN_TYPES = {
    "dms_inventory": {
        "device_id": TYPE_STRING,
        "device_name": TYPE_STRING,
        "device_type": TYPE_STRING,
        "roadway": TYPE_STRING,
        "direction": TYPE_STRING,
        "latitude": TYPE_FLOAT,
        "longitude": TYPE_FLOAT,
        "latitude_raw": TYPE_INTEGER,
        "longitude_raw": TYPE_INTEGER,
    },
    "dms_status": {
        "device_id": TYPE_STRING,
        "oper_status": TYPE_STRING,
        "current_message": TYPE_STRING,
        "beacon_on": TYPE_BOOLEAN,
        "last_update": TYPE_DATETIME,
    },
    "events": {
        "event_id": TYPE_STRING,
        "event_type": TYPE_STRING,
        "event_type_code": TYPE_STRING,
        "severity": TYPE_STRING,
        "status": TYPE_STRING,
        "description": TYPE_STRING,
        "descriptions": TYPE_STRING,
        "locations": TYPE_STRING,
        "update_times": TYPE_STRING,
        "roadway": TYPE_STRING,
        "direction": TYPE_STRING,
        "latitude": TYPE_FLOAT,
        "longitude": TYPE_FLOAT,
        "latitude_raw": TYPE_INTEGER,
        "longitude_raw": TYPE_INTEGER,
        "start_time": TYPE_DATETIME,
        "update_time": TYPE_DATETIME,
    },
}


class TestTheDeclaredColumnContract(unittest.TestCase):
    def test_the_declared_columns_match_this_literal_list(self):
        for resource, expected in EXPECTED_COLUMNS.items():
            with self.subTest(resource=resource):
                self.assertEqual(list(RESOURCE_COLUMNS[resource]), expected)

    def test_the_declared_column_types_match_this_literal_map(self):
        # Values, not just keys. The keys were already pinned; a type value
        # was not pinned anywhere, in either direction.
        self.assertEqual(RESOURCE_COLUMN_TYPES, EXPECTED_COLUMN_TYPES)

    def test_the_two_tables_cover_exactly_the_same_columns(self):
        for resource, expected in EXPECTED_COLUMNS.items():
            with self.subTest(resource=resource):
                self.assertEqual(set(RESOURCE_COLUMN_TYPES[resource]), set(expected))

    def test_the_json_and_timestamp_columns_are_typed_the_way_the_module_says(self):
        # Named individually because these four are the ones with a plausible
        # wrong answer: a JSON array column looks like it wants a nonexistent
        # array type, and an assembled ISO string looks like a plain string.
        types = EXPECTED_COLUMN_TYPES["events"]
        for column in ("descriptions", "locations", "update_times"):
            with self.subTest(column=column):
                self.assertEqual(types[column], TYPE_STRING)
        self.assertEqual(types["update_time"], TYPE_DATETIME)
