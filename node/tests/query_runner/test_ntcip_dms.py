import json
from unittest import TestCase

from redash.query_runner.ntcip_dms import (
    NtcipDms,
    validate_devices,
    validate_polling_limits,
)

VALID_DEVICES = json.dumps(
    [
        {"name": "I-5 NB MP12", "host": "10.0.1.20", "port": 8161},
        {"name": "I-5 SB MP12", "host": "10.0.1.21"},
    ]
)


class TestConfigurationSchema(TestCase):
    def setUp(self):
        self.schema = NtcipDms.configuration_schema()

    def test_community_is_required_secret_with_no_default(self):
        self.assertIn("community", self.schema["required"])
        self.assertIn("community", self.schema["secret"])
        self.assertNotIn("default", self.schema["properties"]["community"])

    def test_community_description_warns_about_cleartext(self):
        # The description must actually say the community string travels in
        # the clear and recommend network isolation: Task 6 renders this text
        # verbatim in the data source form, so its wording is load-bearing.
        description = self.schema["properties"]["community"]["description"].lower()
        self.assertIn("plain text", description)
        self.assertIn("isolat", description)

    def test_default_devices_is_required_with_no_default(self):
        self.assertIn("default_devices", self.schema["required"])
        self.assertNotIn("default", self.schema["properties"]["default_devices"])
        self.assertNotIn("default_devices", self.schema.get("secret", []))

    def test_snmp_version_defaults_to_2c_with_no_auto_fallback_choice(self):
        prop = self.schema["properties"]["snmp_version"]
        self.assertEqual(prop["default"], "2c")
        self.assertEqual(set(prop["enum"]), {"2c", "1"})

    def test_per_device_timeout_and_max_devices_defaults(self):
        self.assertEqual(self.schema["properties"]["per_device_timeout"]["default"], 2)
        self.assertEqual(self.schema["properties"]["max_devices"]["default"], 50)

    def test_type_and_name(self):
        self.assertEqual(NtcipDms.type(), "ntcip_dms")
        self.assertEqual(NtcipDms.name(), "NTCIP 1203 DMS")


class TestValidateDevices(TestCase):
    def test_non_list_is_rejected(self):
        devices, error = validate_devices(json.dumps({"name": "a", "host": "10.0.0.1"}))
        self.assertIsNone(devices)
        self.assertIn("must be a JSON list", error)

    def test_invalid_json_is_rejected(self):
        devices, error = validate_devices("{not json")
        self.assertIsNone(devices)
        self.assertIn("invalid JSON", error)

    def test_non_object_element_is_named_by_index(self):
        devices, error = validate_devices(json.dumps(["not-an-object"]))
        self.assertIsNone(devices)
        self.assertIn("device at index 0", error)
        self.assertIn("must be a JSON object", error)

    def test_missing_name_is_named_by_index(self):
        devices, error = validate_devices(json.dumps([{"host": "10.0.0.1"}]))
        self.assertIsNone(devices)
        self.assertIn("device at index 0", error)
        self.assertIn("missing a 'name'", error)

    def test_missing_host_is_named_by_device_name(self):
        devices, error = validate_devices(json.dumps([{"name": "Sign A"}]))
        self.assertIsNone(devices)
        self.assertIn("'Sign A'", error)
        self.assertIn("missing a 'host'", error)

    def test_port_outside_range_is_named_by_device_name(self):
        devices, error = validate_devices(
            json.dumps([{"name": "Sign A", "host": "10.0.0.1", "port": 70000}])
        )
        self.assertIsNone(devices)
        self.assertIn("'Sign A'", error)
        self.assertIn("port outside 1-65535", error)

    def test_port_zero_is_outside_range(self):
        devices, error = validate_devices(json.dumps([{"name": "Sign A", "host": "10.0.0.1", "port": 0}]))
        self.assertIsNone(devices)
        self.assertIn("'Sign A'", error)
        self.assertIn("port outside 1-65535", error)

    def test_non_integer_port_is_named_by_device_name(self):
        devices, error = validate_devices(
            json.dumps([{"name": "Sign A", "host": "10.0.0.1", "port": "not-a-number"}])
        )
        self.assertIsNone(devices)
        self.assertIn("'Sign A'", error)
        self.assertIn("non-integer port", error)

    def test_bool_port_is_rejected_as_non_integer(self):
        devices, error = validate_devices(json.dumps([{"name": "Sign A", "host": "10.0.0.1", "port": True}]))
        self.assertIsNone(devices)
        self.assertIn("'Sign A'", error)
        self.assertIn("non-integer port", error)

    def test_duplicate_name_is_named_by_device_name(self):
        raw = json.dumps(
            [
                {"name": "Sign A", "host": "10.0.0.1"},
                {"name": "Sign A", "host": "10.0.0.2"},
            ]
        )
        devices, error = validate_devices(raw)
        self.assertIsNone(devices)
        self.assertIn("'Sign A'", error)
        self.assertIn("duplicate device name", error)

    def test_empty_list_is_rejected(self):
        devices, error = validate_devices("[]")
        self.assertIsNone(devices)
        self.assertIn("at least one device is required", error)

    def test_valid_input_with_port_defaulting(self):
        devices, error = validate_devices(VALID_DEVICES)
        self.assertIsNone(error)
        self.assertEqual(
            devices,
            [
                {"name": "I-5 NB MP12", "host": "10.0.1.20", "port": 8161},
                {"name": "I-5 SB MP12", "host": "10.0.1.21", "port": 161},
            ],
        )


class TestValidatePollingLimits(TestCase):
    def test_valid_values_pass(self):
        self.assertIsNone(validate_polling_limits(2, 50))
        self.assertIsNone(validate_polling_limits(1, 1))

    def test_fractional_max_devices_is_rejected(self):
        error = validate_polling_limits(2, 1.5)
        self.assertIsNotNone(error)
        self.assertIn("max_devices", error)
        self.assertIn("1.5", error)

    def test_zero_max_devices_is_rejected(self):
        error = validate_polling_limits(2, 0)
        self.assertIsNotNone(error)
        self.assertIn("max_devices", error)
        self.assertIn("0", error)

    def test_negative_max_devices_is_rejected(self):
        error = validate_polling_limits(2, -5)
        self.assertIsNotNone(error)
        self.assertIn("max_devices", error)
        self.assertIn("-5", error)

    def test_bool_max_devices_is_rejected_as_non_integer(self):
        error = validate_polling_limits(2, True)
        self.assertIsNotNone(error)
        self.assertIn("max_devices", error)

    def test_fractional_per_device_timeout_is_rejected(self):
        error = validate_polling_limits(1.5, 50)
        self.assertIsNotNone(error)
        self.assertIn("per_device_timeout", error)
        self.assertIn("1.5", error)

    def test_zero_per_device_timeout_is_rejected(self):
        error = validate_polling_limits(0, 50)
        self.assertIsNotNone(error)
        self.assertIn("per_device_timeout", error)
        self.assertIn("0", error)

    def test_negative_per_device_timeout_is_rejected(self):
        error = validate_polling_limits(-1, 50)
        self.assertIsNotNone(error)
        self.assertIn("per_device_timeout", error)
        self.assertIn("-1", error)

    def test_bool_per_device_timeout_is_rejected_as_non_integer(self):
        error = validate_polling_limits(False, 50)
        self.assertIsNotNone(error)
        self.assertIn("per_device_timeout", error)

    def test_max_devices_is_checked_before_per_device_timeout(self):
        # Both fields are invalid at once; the error names max_devices, not
        # per_device_timeout, so a caller fixing one field at a time is not
        # sent to the wrong one first.
        error = validate_polling_limits(-1, -1)
        self.assertIn("max_devices", error)


class TestNtcipDmsInit(TestCase):
    def test_valid_configuration_parses_devices(self):
        runner = NtcipDms({"community": "public", "default_devices": VALID_DEVICES})
        self.assertIsNone(runner.devices_error)
        self.assertEqual(len(runner.devices), 2)
        self.assertEqual(runner.snmp_version, "2c")
        self.assertEqual(runner.per_device_timeout, 2)
        self.assertEqual(runner.max_devices, 50)
        self.assertIsNone(runner.limits_error)

    def test_invalid_configuration_stores_the_error_rather_than_raising(self):
        runner = NtcipDms({"community": "public", "default_devices": "[]"})
        self.assertIsNone(runner.devices)
        self.assertIn("at least one device is required", runner.devices_error)

    def test_fractional_max_devices_stores_the_error_rather_than_raising(self):
        runner = NtcipDms(
            {"community": "public", "default_devices": VALID_DEVICES, "max_devices": 1.5}
        )
        self.assertIsNotNone(runner.devices)  # device-list validation is independent
        self.assertIn("max_devices", runner.limits_error)

    def test_negative_per_device_timeout_stores_the_error_rather_than_raising(self):
        runner = NtcipDms(
            {"community": "public", "default_devices": VALID_DEVICES, "per_device_timeout": -1}
        )
        self.assertIsNotNone(runner.devices)
        self.assertIn("per_device_timeout", runner.limits_error)
