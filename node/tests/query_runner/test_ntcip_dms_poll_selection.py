"""
Tests for NTCIP DMS device selection, `test_connection`/`noop_query`, and
the validation gates in `run_query`. Split out of test_ntcip_dms_poll.py,
which covers the timing contract and the aggregate predicate, to keep both
files under the repo's 300-line limit.
"""

import json
from unittest import TestCase
from unittest.mock import patch

from redash.query_runner import ntcip_dms_poll
from redash.query_runner.ntcip_dms import NtcipDms
from tests.query_runner.ntcip_dms_poll_fixtures import (
    DEVICE_A,
    DEVICE_B,
    DEVICE_C,
    healthy_response,
    make_runner,
    stub_sync_get,
    timeout_response,
)


class TestDeviceSelection(TestCase):
    def test_params_devices_selects_a_subset(self):
        runner = make_runner([DEVICE_A, DEVICE_B, DEVICE_C])
        responses = {
            DEVICE_A["host"]: healthy_response(),
            DEVICE_B["host"]: healthy_response(),
            DEVICE_C["host"]: healthy_response(),
        }
        query = json.dumps({"resource": "dms_identity", "params": {"devices": ["Sign B"]}})
        with patch.object(ntcip_dms_poll, "_sync_get", stub_sync_get(responses)):
            data, error = runner.run_query(query, None)

        self.assertIsNone(error)
        self.assertEqual([row["device"] for row in data["rows"]], ["Sign B"])

    def test_unknown_device_name_fails_validation(self):
        runner = make_runner([DEVICE_A])
        query = json.dumps({"resource": "dms_identity", "params": {"devices": ["No Such Sign"]}})
        data, error = runner.run_query(query, None)

        self.assertIsNone(data)
        self.assertIn("No Such Sign", error)

    def test_max_devices_caps_after_selection(self):
        runner = make_runner([DEVICE_A, DEVICE_B, DEVICE_C], max_devices=2)
        responses = {
            DEVICE_A["host"]: healthy_response(),
            DEVICE_B["host"]: healthy_response(),
            DEVICE_C["host"]: healthy_response(),
        }
        with patch.object(ntcip_dms_poll, "_sync_get", stub_sync_get(responses)):
            data, error = runner.run_query(json.dumps({"resource": "dms_identity"}), None)

        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 2)
        self.assertEqual([row["device"] for row in data["rows"]], ["Sign A", "Sign B"])


class TestNoopAndTestConnection(TestCase):
    def test_test_connection_fails_without_devices_configured(self):
        runner = make_runner([])  # devices_error set, runner.devices is None
        with self.assertRaisesRegex(Exception, "configure at least one device"):
            runner.test_connection()

    def test_test_connection_only_reaches_the_first_device(self):
        runner = make_runner([DEVICE_A, DEVICE_B])
        seen_hosts = []

        def _stub(host, port, oids, community, mp_model, timeout):
            seen_hosts.append(host)
            return healthy_response()

        with patch.object(ntcip_dms_poll, "_sync_get", _stub):
            runner.test_connection()  # must not raise

        self.assertEqual(seen_hosts, [DEVICE_A["host"]])

    def test_test_connection_raises_on_query_error(self):
        runner = make_runner([DEVICE_A])
        responses = {DEVICE_A["host"]: timeout_response()}
        with patch.object(ntcip_dms_poll, "_sync_get", stub_sync_get(responses)):
            with self.assertRaises(Exception):
                runner.test_connection()

    def test_noop_query_targets_dms_identity(self):
        self.assertEqual(json.loads(NtcipDms.noop_query), {"resource": "dms_identity"})


class TestValidationGates(TestCase):
    def test_devices_error_short_circuits_run_query(self):
        runner = make_runner([])
        data, error = runner.run_query(json.dumps({"resource": "dms_identity"}), None)
        self.assertIsNone(data)
        self.assertIn("at least one device is required", error)

    def test_limits_error_short_circuits_run_query(self):
        # A bad max_devices must stop the query before it ever reaches the
        # transport, not just fail validate_polling_limits in isolation.
        runner = make_runner([DEVICE_A], max_devices=0)
        called = []

        def _stub(*args, **kwargs):
            called.append(True)
            return healthy_response()

        with patch.object(ntcip_dms_poll, "_sync_get", _stub):
            data, error = runner.run_query(json.dumps({"resource": "dms_identity"}), None)

        self.assertIsNone(data)
        self.assertIn("max_devices", error)
        self.assertEqual(called, [])

    def test_unknown_resource_is_a_validation_error(self):
        runner = make_runner([DEVICE_A])
        data, error = runner.run_query(json.dumps({"resource": "not_a_resource"}), None)
        self.assertIsNone(data)
        self.assertIn("Unknown resource", error)

    # Finding 4: parse_json_query only proves the text is valid JSON, not
    # that it decoded to an object. A query of "[]", "null" or a bare
    # number parses cleanly and used to reach `config.get("resource")`,
    # which raises AttributeError instead of returning the (None, error)
    # shape every other validation failure here uses.
    def test_a_json_array_query_is_a_validation_error_not_a_crash(self):
        runner = make_runner([DEVICE_A])
        data, error = runner.run_query("[]", None)
        self.assertIsNone(data)
        self.assertIn("must be a JSON object", error)

    def test_a_json_null_query_is_a_validation_error_not_a_crash(self):
        runner = make_runner([DEVICE_A])
        data, error = runner.run_query("null", None)
        self.assertIsNone(data)
        self.assertIn("must be a JSON object", error)

    def test_a_bare_number_query_is_a_validation_error_not_a_crash(self):
        runner = make_runner([DEVICE_A])
        data, error = runner.run_query("42", None)
        self.assertIsNone(data)
        self.assertIn("must be a JSON object", error)

    def test_a_non_object_params_is_a_validation_error_not_a_crash(self):
        runner = make_runner([DEVICE_A])
        query = json.dumps({"resource": "dms_identity", "params": ["Sign A"]})
        data, error = runner.run_query(query, None)
        self.assertIsNone(data)
        self.assertIn("'params' must be a JSON object", error)
