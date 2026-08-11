"""
Tests for the NTCIP DMS polling loop's timing contract and the aggregate
"no healthy rows" predicate: `NtcipDms.run_query` against a stubbed SNMP
layer (`ntcip_dms_poll._sync_get`).

Device selection, `test_connection`/`noop_query`, and the validation
gates live in the sibling test_ntcip_dms_poll_selection.py, split out to
keep both files under the repo's 300-line limit.

Order matters here: the no-healthy-rows cases come first, in all three
shapes the aggregate predicate has to catch (all error, all skipped, a
mixture of the two), because that predicate is the one thing stopping a
fleet-wide outage from reading as a successful table.
"""

import asyncio
import json
import time
from unittest import TestCase
from unittest.mock import patch

from redash.query_runner import ntcip_dms_poll
from redash.query_runner.ntcip_dms_rows import RESOURCE_COLUMN_TYPES, RESOURCE_COLUMNS
from tests.query_runner.ntcip_dms_poll_fixtures import (
    DEVICE_A,
    DEVICE_B,
    FakeClock,
    healthy_response,
    make_runner,
    pdu_error_response,
    stub_sync_get,
    timeout_response,
)


class TestNoHealthyRows(TestCase):
    """The aggregate predicate: (None, error) whenever no device produced
    a healthy row, in each of its three shapes."""

    def test_all_devices_error_returns_none_and_error(self):
        runner = make_runner([DEVICE_A, DEVICE_B])
        responses = {DEVICE_A["host"]: timeout_response(), DEVICE_B["host"]: timeout_response()}
        with patch.object(ntcip_dms_poll, "_sync_get", stub_sync_get(responses)):
            data, error = runner.run_query(json.dumps({"resource": "dms_identity"}), None)

        self.assertIsNone(data)
        self.assertIsNotNone(error)
        self.assertIn("dms_identity", error)

    def test_all_devices_skipped_returns_none_and_error(self):
        # A near-zero request_timeout exhausts the deadline before the
        # first device is even attempted, so every row is skipped, not
        # errored: _sync_get must never be called.
        runner = make_runner([DEVICE_A, DEVICE_B], request_timeout=0)

        def _unexpected(*args, **kwargs):
            raise AssertionError("a skipped device must not reach the transport")

        with patch.object(ntcip_dms_poll, "_sync_get", _unexpected):
            data, error = runner.run_query(json.dumps({"resource": "dms_identity"}), None)

        self.assertIsNone(data)
        self.assertIsNotNone(error)

    def test_mixed_error_and_skipped_returns_none_and_error(self):
        # request_timeout=1 leaves a tiny budget: device A's transaction
        # itself consumes it (simulated via the fake clock below), so
        # device B is skipped. Neither device is healthy.
        clock = FakeClock()
        runner = make_runner([DEVICE_A, DEVICE_B], request_timeout=1)

        def _device_a():
            clock.advance(2)
            return timeout_response()

        responses = {DEVICE_A["host"]: _device_a}
        with (
            patch.object(ntcip_dms_poll.time, "monotonic", clock),
            patch.object(ntcip_dms_poll, "_sync_get", stub_sync_get(responses)),
        ):
            data, error = runner.run_query(json.dumps({"resource": "dms_identity"}), None)

        self.assertIsNone(data)
        self.assertIsNotNone(error)


class TestHealthyPolling(TestCase):
    def test_one_healthy_device_returns_a_table(self):
        runner = make_runner([DEVICE_A])
        responses = {DEVICE_A["host"]: healthy_response()}
        with patch.object(ntcip_dms_poll, "_sync_get", stub_sync_get(responses)):
            data, error = runner.run_query(json.dumps({"resource": "dms_identity"}), None)

        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 1)
        row = data["rows"][0]
        self.assertEqual(row["poll_status"], "healthy")
        self.assertEqual(row["sign_type"], "cms")
        self.assertIsNone(row["error"])

    def test_one_device_times_out_while_another_succeeds(self):
        runner = make_runner([DEVICE_A, DEVICE_B])
        responses = {
            DEVICE_A["host"]: timeout_response(),
            DEVICE_B["host"]: healthy_response(),
        }
        with patch.object(ntcip_dms_poll, "_sync_get", stub_sync_get(responses)):
            data, error = runner.run_query(json.dumps({"resource": "dms_identity"}), None)

        self.assertIsNone(error)
        by_device = {row["device"]: row for row in data["rows"]}
        self.assertEqual(by_device["Sign A"]["poll_status"], "error")
        self.assertIsNotNone(by_device["Sign A"]["error"])
        self.assertEqual(by_device["Sign B"]["poll_status"], "healthy")

    def test_first_device_errors_but_full_column_set_survives(self):
        """Finding A: to_redash_table derives columns from the FIRST
        record. If the first device errors and its row is missing the
        healthy-only keys, the whole table silently loses those columns.
        Every row must be built from the same template regardless of
        poll_status."""
        runner = make_runner([DEVICE_A, DEVICE_B])
        responses = {
            DEVICE_A["host"]: timeout_response(),
            DEVICE_B["host"]: healthy_response(),
        }
        with patch.object(ntcip_dms_poll, "_sync_get", stub_sync_get(responses)):
            data, error = runner.run_query(json.dumps({"resource": "dms_identity"}), None)

        self.assertIsNone(error)
        column_names = {col["name"] for col in data["columns"]}
        self.assertEqual(column_names, set(RESOURCE_COLUMNS["dms_identity"]))
        for row in data["rows"]:
            self.assertEqual(set(row.keys()), set(RESOURCE_COLUMNS["dms_identity"]))

        # Finding 3: to_redash_table (connector_base's shared helper) infers
        # a column's type from the first record, and the first device here
        # errors, so every decoded value in it is None. A numeric column
        # like height_mm must still type as an integer, not a string,
        # because the runner now serializes against RESOURCE_COLUMN_TYPES's
        # declared types rather than inferring from row 0.
        column_types = {col["name"]: col["type"] for col in data["columns"]}
        self.assertEqual(column_types, RESOURCE_COLUMN_TYPES["dms_identity"])
        self.assertEqual(column_types["height_mm"], "integer")
        self.assertEqual(column_types["sign_type"], "string")

    def test_deadline_expiring_skips_a_later_device(self):
        clock = FakeClock()
        runner = make_runner([DEVICE_A, DEVICE_B], request_timeout=5)

        def _device_a():
            clock.advance(6)  # blows through the whole-query deadline
            return healthy_response()

        responses = {DEVICE_A["host"]: _device_a}
        with (
            patch.object(ntcip_dms_poll.time, "monotonic", clock),
            patch.object(ntcip_dms_poll, "_sync_get", stub_sync_get(responses)),
        ):
            data, error = runner.run_query(json.dumps({"resource": "dms_identity"}), None)

        self.assertIsNone(error)
        by_device = {row["device"]: row for row in data["rows"]}
        self.assertEqual(by_device["Sign A"]["poll_status"], "healthy")
        self.assertEqual(by_device["Sign B"]["poll_status"], "skipped")
        self.assertIsNone(by_device["Sign B"]["error"])

    def test_per_device_timeout_is_bounded_by_remaining_budget(self):
        # request_timeout leaves 1s of budget by the time device B is
        # reached, well under its 10s per_device_timeout: the transaction
        # bound passed to the transport must be the smaller number.
        clock = FakeClock()
        runner = make_runner([DEVICE_A, DEVICE_B], request_timeout=5, per_device_timeout=10)
        seen_timeouts = {}

        def _device_a():
            clock.advance(4)
            return healthy_response()

        def _stub(host, port, oids, community, mp_model, timeout):
            if host == DEVICE_A["host"]:
                return _device_a()
            seen_timeouts[host] = timeout
            return healthy_response()

        with (
            patch.object(ntcip_dms_poll.time, "monotonic", clock),
            patch.object(ntcip_dms_poll, "_sync_get", _stub),
        ):
            data, error = runner.run_query(json.dumps({"resource": "dms_identity"}), None)

        self.assertIsNone(error)
        self.assertLessEqual(seen_timeouts[DEVICE_B["host"]], 1.0)
        self.assertGreater(seen_timeouts[DEVICE_B["host"]], 0)


class TestV1NoSuchNameSemantics(TestCase):
    """v1's noSuchName poisons the whole varbind group: a non-zero
    error_status with no trustworthy per-varbind values, unlike v2c's
    per-varbind NoSuchObject/NoSuchInstance sentinels at error_status=0.
    Not exercised against a real v1 agent (see task-4-report.md); this
    pins the documented PDU-level shape against the transport stub.
    """

    def test_pdu_level_error_is_a_device_error_not_a_partial_decode(self):
        runner = make_runner([DEVICE_A, DEVICE_B], snmp_version="1")
        responses = {
            DEVICE_A["host"]: pdu_error_response(error_index=2),
            DEVICE_B["host"]: healthy_response(),
        }
        with patch.object(ntcip_dms_poll, "_sync_get", stub_sync_get(responses)):
            data, error = runner.run_query(json.dumps({"resource": "dms_identity"}), None)

        self.assertIsNone(error)
        by_device = {row["device"]: row for row in data["rows"]}
        self.assertEqual(by_device["Sign A"]["poll_status"], "error")
        # The whole row is untrusted, not just the one poisoned varbind:
        # every decoded field stays None rather than a partial decode.
        for field in ("sys_name", "sign_type", "height_mm"):
            self.assertIsNone(by_device["Sign A"][field])
        self.assertIn("2", by_device["Sign A"]["error"])

    def test_v1_uses_mp_model_zero(self):
        seen_mp_models = []
        runner = make_runner([DEVICE_A], snmp_version="1")

        def _stub(host, port, oids, community, mp_model, timeout):
            seen_mp_models.append(mp_model)
            return healthy_response()

        with patch.object(ntcip_dms_poll, "_sync_get", _stub):
            runner.run_query(json.dumps({"resource": "dms_identity"}), None)

        self.assertEqual(seen_mp_models, [0])


class TestHangingTargetCreationIsBounded(TestCase):
    """Finding 1: pysnmp's own `timeout` argument only bounds the GET's
    response wait. UdpTransportTarget.create() awaits getaddrinfo outside
    that budget, so a slow or hanging DNS resolver must not hold a device's
    transaction, and the RQ worker running it, past its bound."""

    def test_hanging_target_creation_produces_an_error_row_within_the_bound(self):
        async def _hang(*args, **kwargs):
            await asyncio.sleep(100)

        start = time.monotonic()
        with patch.object(ntcip_dms_poll.hlapi.UdpTransportTarget, "create", _hang):
            values, error = ntcip_dms_poll._poll_device(DEVICE_A, "dms_identity", "public", 1, 0.2)
        elapsed = time.monotonic() - start

        self.assertIsNone(values)
        self.assertIsNotNone(error)
        # Well clear of the 100s hang, and well clear of the 0.2s bound
        # itself too, so this fails if the wait_for wrapper is ever removed
        # or narrowed back down to just the GET.
        self.assertLess(elapsed, 2.0)


class TestRetriesAreZero(TestCase):
    def test_udp_transport_target_is_built_with_retries_zero(self):
        # A regression guard for the timing contract: pysnmp's own default
        # would silently double every budget this module's deadline math
        # depends on.
        import inspect

        source = inspect.getsource(ntcip_dms_poll._get_cmd_async)
        self.assertIn("retries=RETRIES", source)
        self.assertEqual(ntcip_dms_poll.RETRIES, 0)
