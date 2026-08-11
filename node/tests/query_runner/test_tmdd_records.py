"""
What the TMDD runner returns: the fixed table, the record cap, and the two
client-side filters.

No HTTP here. `post_soap` is replaced with the bytes a center would have
sent, which is the same seam the transport tests approach from the other
side. The ordering between the three limits is the thing most of this module
exists to pin: `max_records` is a cap that ERRORS and `limit` is a truncation
the query asked for, so a cap applied after a truncation would wave a
50,000-record response through whenever a limit was set.
"""

import json
import unittest
from unittest import mock

from redash.query_runner.tmdd import TMDD
from redash.query_runner.tmdd_config import ALLOWED_PARAMS, SINCE_COLUMNS
from redash.query_runner.tmdd_rows import RESOURCE_COLUMNS
from redash.query_runner.tmdd_transport import apply_record_limits
from tests.query_runner.test_tmdd_columns import EXPECTED_COLUMN_TYPES
from tests.query_runner.tmdd_fixtures import (
    CONTENT_IN_BOTH_DETAILS,
    ELEVEN_DEVICES,
    SPARSE_FIRST_RECORD,
    TWO_SIGNS_HALF_AN_HOUR_APART,
)

BASE = {"endpoint_url": "https://c2c.example.org/tmdd", "organization_id": "ORG-1"}


class RecordCase(unittest.TestCase):
    def run_with(self, body, resource="dms_inventory", params=None, **configuration):
        query = json.dumps({"resource": resource, "params": params or {}})
        runner = TMDD(dict(BASE, **configuration))
        with mock.patch("redash.query_runner.tmdd.post_soap", return_value=(body.encode(), body)):
            return runner.run_query(query, None)

    def values(self, data, column):
        return [row[column] for row in data["rows"]]


class TestTheFixedColumnSet(RecordCase):
    def test_the_returned_table_carries_the_declared_columns_and_types(self):
        # The base's to_redash_table infers both from record one. Reaching the
        # returned table through run_query is the only way to prove the
        # override is actually in the path someone queries through.
        #
        # Against the LITERAL in test_tmdd_columns, not against
        # RESOURCE_COLUMN_TYPES. This assertion used to compare the emitted
        # types to the same dictionary that emitted them, so retyping
        # beacon_on to a string, or the coordinates to strings, changed how
        # Redash filters and charts those columns with the suite green.
        data, error = self.run_with(ELEVEN_DEVICES, max_records=20)
        self.assertIsNone(error)
        self.assertEqual([c["name"] for c in data["columns"]], RESOURCE_COLUMNS["dms_inventory"])
        self.assertEqual(
            {c["name"]: c["type"] for c in data["columns"]},
            EXPECTED_COLUMN_TYPES["dms_inventory"],
        )

    def test_an_empty_result_still_carries_the_whole_column_set(self):
        # The decisive case, and the one the two tests around it turned out
        # not to be. The decoder already fills every key from a template, so
        # inference from record one recovers the right names and, for
        # dms_inventory, the right types too; both of those tests pass
        # against the base's to_redash_table. This one cannot: to_redash_table
        # returns NO columns at all for an empty record list, so a table a
        # filter emptied would arrive with no schema and read as a broken
        # query rather than as no rows.
        data, error = self.run_with(ELEVEN_DEVICES, params={"limit": 0}, max_records=20)
        self.assertIsNone(error)
        self.assertEqual(data["rows"], [])
        self.assertEqual([c["name"] for c in data["columns"]], RESOURCE_COLUMNS["dms_inventory"])

    def test_a_sparse_first_record_does_not_narrow_the_returned_table(self):
        # The fixture leads with a device carrying no route-designator and no
        # link-direction, which is what inference from record one drops for
        # the whole table.
        data, error = self.run_with(SPARSE_FIRST_RECORD)
        self.assertIsNone(error)
        self.assertEqual([c["name"] for c in data["columns"]], RESOURCE_COLUMNS["dms_inventory"])
        self.assertEqual(self.values(data, "roadway"), [None, "I-5"])

    def test_a_numeric_column_keeps_its_type_when_record_one_is_missing_it(self):
        data, _error = self.run_with(TWO_SIGNS_HALF_AN_HOUR_APART, resource="dms_status")
        types = {c["name"]: c["type"] for c in data["columns"]}
        self.assertEqual(types, EXPECTED_COLUMN_TYPES["dms_status"])

    def test_the_raw_response_text_is_what_reaches_the_redis_publish(self):
        query = json.dumps({"resource": "dms_inventory", "pubsub_channel": "feed:dms"})
        runner = TMDD(dict(BASE))
        body = SPARSE_FIRST_RECORD
        with mock.patch("redash.query_runner.tmdd.post_soap", return_value=(body.encode(), body)):
            with mock.patch.object(TMDD, "_publish_to_redis") as publish:
                runner.run_query(query, None)
        self.assertEqual(publish.call_args.args[3], body)


class TestTheRecordCap(RecordCase):
    def test_more_records_than_max_records_is_an_error_not_a_truncation(self):
        data, error = self.run_with(ELEVEN_DEVICES, max_records=10)
        self.assertIsNone(data)
        self.assertIn("max_records", error)
        self.assertIn("11", error)

    def test_exactly_max_records_is_allowed_through(self):
        # The cap is "more than", not "as many as". Without this the boundary
        # could move by one and nothing would notice.
        data, error = self.run_with(ELEVEN_DEVICES, max_records=11)
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 11)

    def test_the_cap_is_applied_before_limit_truncates(self):
        # The whole reason the order is written down: with the two swapped,
        # any query carrying a limit would silently bypass the cap.
        data, error = self.run_with(ELEVEN_DEVICES, params={"limit": 3}, max_records=10)
        self.assertIsNone(data)
        self.assertIn("max_records", error)

    def test_the_default_cap_lets_an_ordinary_response_through(self):
        _data, error = self.run_with(ELEVEN_DEVICES)
        self.assertIsNone(error)


class TestLimitAndSince(RecordCase):
    def test_limit_truncates_client_side(self):
        data, error = self.run_with(ELEVEN_DEVICES, params={"limit": 3}, max_records=20)
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 3)
        self.assertEqual(self.values(data, "device_id"), ["DMS-001", "DMS-002", "DMS-003"])

    def test_a_limit_of_zero_returns_no_rows_rather_than_every_row(self):
        data, _error = self.run_with(ELEVEN_DEVICES, params={"limit": 0}, max_records=20)
        self.assertEqual(data["rows"], [])

    def test_since_drops_the_records_older_than_it(self):
        data, error = self.run_with(
            TWO_SIGNS_HALF_AN_HOUR_APART, resource="dms_status", params={"since": "2026-08-07T15:20:00Z"}
        )
        self.assertIsNone(error)
        self.assertEqual(self.values(data, "device_id"), ["DMS-002"])

    def test_since_keeps_a_record_stamped_exactly_at_the_boundary(self):
        data, _error = self.run_with(
            TWO_SIGNS_HALF_AN_HOUR_APART, resource="dms_status", params={"since": "2026-08-07T15:30:00Z"}
        )
        self.assertEqual(self.values(data, "device_id"), ["DMS-002"])

    def test_since_reads_the_events_timestamp_column_too(self):
        # The mirror of the dms_status case. Without it SINCE_COLUMNS could
        # name the wrong column for events and only one resource would notice.
        kept, _error = self.run_with(
            CONTENT_IN_BOTH_DETAILS, resource="events", params={"since": "2026-08-07T14:00:00Z"}
        )
        dropped, _error = self.run_with(
            CONTENT_IN_BOTH_DETAILS, resource="events", params={"since": "2026-08-07T16:00:00Z"}
        )
        self.assertEqual(len(kept["rows"]), 1)
        self.assertEqual(dropped["rows"], [])

    def test_since_runs_before_limit_truncates(self):
        # Decisive with two records: since keeps only the newer one, so a
        # limit of 1 applied first would take the older one and since would
        # then drop it, leaving nothing.
        data, _error = self.run_with(
            TWO_SIGNS_HALF_AN_HOUR_APART,
            resource="dms_status",
            params={"since": "2026-08-07T15:20:00Z", "limit": 1},
        )
        self.assertEqual(self.values(data, "device_id"), ["DMS-002"])


class TestTheFilterItself(unittest.TestCase):
    """apply_record_limits directly, for the cases no fixture can carry."""

    def filter_since(self, value, since):
        records = [{"device_id": "DMS-001", "last_update": value}]
        return apply_record_limits("dms_status", records, {}, {"since": since})

    def test_a_record_with_no_timestamp_is_kept(self):
        # last-comm-time is optional in the schema, so a center that omits it
        # is not saying the record is old. Dropping it would hide a live sign
        # behind a filter the user meant only to narrow by time.
        self.assertEqual(len(self.filter_since(None, "2026-08-07T15:20:00Z")), 1)

    def test_a_naive_record_timestamp_is_read_as_utc(self):
        # The center sent no offset, so the decoder emitted none. Comparing an
        # aware filter against a naive value raises TypeError in Python, and
        # the alternatives are to drop every such record or to crash.
        self.assertEqual(len(self.filter_since("2026-08-07T15:00:00", "2026-08-07T14:00:00Z")), 1)
        self.assertEqual(len(self.filter_since("2026-08-07T15:00:00", "2026-08-07T16:00:00Z")), 0)

    def test_absent_params_leave_the_records_alone(self):
        records = [{"device_id": "DMS-001", "last_update": None}]
        self.assertEqual(apply_record_limits("dms_status", records, {}, {}), records)


class TestTheValidationInFrontOfThem(RecordCase):
    def test_an_unparseable_since_is_a_param_error_not_a_failed_request(self):
        # Applied client-side after decode, so a value the filter cannot read
        # would otherwise raise inside _fetch and be reported as a request
        # that failed against a center which answered perfectly well.
        data, error = self.run_with(ELEVEN_DEVICES, resource="dms_status", params={"since": "last tuesday"})
        self.assertIsNone(data)
        self.assertIn("since", error)
        self.assertNotIn("request failed", error)

    def test_a_limit_that_is_not_a_whole_number_of_rows_is_refused(self):
        for value in ("3", -1, 2.5, True):
            with self.subTest(limit=value):
                data, error = self.run_with(ELEVEN_DEVICES, params={"limit": value})
                self.assertIsNone(data)
                self.assertIn("limit", error)
                self.assertNotIn("request failed", error)

    def test_a_cap_that_is_not_a_positive_number_is_a_configuration_error(self):
        for field in ("max_records", "max_response_mb"):
            for value in (0, -5, "lots"):
                with self.subTest(field=field, value=value):
                    error = TMDD(dict(BASE, **{field: value})).config_error
                    self.assertIn(field, error)
                    self.assertNotIn("request failed", error)

    def test_a_cap_that_is_not_a_finite_number_is_a_configuration_error(self):
        # float() accepts "nan", "inf" and "infinity" in any spelling, and
        # neither is caught by a `<= 0` floor: nan fails every comparison and
        # inf fails this one. Both were accepted as caps before the fix.
        for field in ("max_records", "max_response_mb"):
            for value in ("nan", "NaN", "inf", "-inf", "Infinity", float("nan"), float("inf")):
                with self.subTest(field=field, value=value):
                    error = TMDD(dict(BASE, **{field: value})).config_error
                    self.assertIn(field, error)
                    self.assertNotIn("request failed", error)

    def test_a_nan_max_records_does_not_wave_an_oversized_response_through(self):
        # The decisive case, and the reason the guard above is not enough on
        # its own. `len(records) > max_records` is `11 > nan`, which is False,
        # so the cap was not merely lenient, it was OFF: this returned all
        # eleven rows and no error at all.
        data, error = self.run_with(ELEVEN_DEVICES, max_records=float("nan"))
        self.assertIsNone(data)
        self.assertIn("max_records", error)

    def test_an_infinite_max_records_does_not_wave_one_through_either(self):
        # inf disables the cap the honest way, and would read as "no limit"
        # to someone who typed it. The field's contract is a number greater
        # than zero, and there is no documented way to turn the cap off.
        data, error = self.run_with(ELEVEN_DEVICES, max_records=float("inf"))
        self.assertIsNone(data)
        self.assertIn("max_records", error)

    def test_a_non_finite_max_response_mb_fails_before_the_request_not_during(self):
        # max_response_mb reaches post_soap, where it becomes
        # int(megabytes * BYTES_PER_MB) AFTER requests.post has opened the
        # response. int(nan) raises ValueError there, and the base dresses it
        # up as "request failed", blaming a center that answered fine.
        data, error = self.run_with(ELEVEN_DEVICES, max_response_mb=float("nan"))
        self.assertIsNone(data)
        self.assertIn("max_response_mb", error)
        self.assertNotIn("request failed", error)

    def test_an_empty_cap_field_falls_back_to_the_documented_default(self):
        # A data source saved before the field existed holds "" rather than a
        # number, and that is not a misconfiguration.
        self.assertIsNone(TMDD(dict(BASE, max_records="", max_response_mb="")).config_error)

    def test_the_since_column_table_agrees_with_the_allowed_param_table(self):
        self.assertEqual(
            set(SINCE_COLUMNS),
            {resource for resource, params in ALLOWED_PARAMS.items() if "since" in params},
        )
