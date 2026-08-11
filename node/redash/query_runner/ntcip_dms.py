"""
NTCIP 1203 DMS query runner.

Center-to-field polling of dynamic message signs (DMS) over SNMP, per the
NTCIP 1203 standard: identity, status, and current message. Strictly
read-only, SNMP GET only, never SET.

This module holds the configuration schema and the polling entry points
(`run_query`, `test_connection`, `noop_query`). Four sibling modules do
the rest, all split out to keep every file under the repo's 300-line
limit: `ntcip_dms_validation` validates `default_devices` and the numeric
polling controls, `ntcip_dms_decode` is the pure OID/enum/bitmap decode
layer, `ntcip_dms_poll` is the SNMP transport and the deadline-bounded
polling loop, and `ntcip_dms_rows` owns the row/column shape and the
fixed-type serialization `run_query` returns.

Device addressing is configuration, not query input: `default_devices` in
the data source configuration is the only source of poll targets. A query
can select a subset of these devices by name, but it cannot supply a host
or port of its own, so this runner cannot be used to probe arbitrary
addresses.
"""

import json

from redash.query_runner import register
from redash.query_runner.connector_base import (
    BaseResourceRunner,
    build_configuration_schema,
    serialize_result,
)
from redash.query_runner.connector_validation import parse_object_query
from redash.query_runner.ntcip_dms_decode import (
    OIDS,
    RESOURCE_FIELDS,
    decode_dms_identity,
    decode_dms_message,
    decode_dms_status,
    decode_multi,
)
from redash.query_runner.ntcip_dms_poll import (
    aggregated_error,
    poll_devices,
    select_devices,
)
from redash.query_runner.ntcip_dms_rows import RESOURCE_COLUMNS, to_typed_table
from redash.query_runner.ntcip_dms_validation import (
    validate_devices,
    validate_polling_limits,
)

__all__ = [
    "NtcipDms",
    "validate_devices",
    "validate_polling_limits",
    "OIDS",
    "RESOURCE_FIELDS",
    "decode_dms_identity",
    "decode_dms_status",
    "decode_dms_message",
    "decode_multi",
]

DEFAULT_SNMP_VERSION = "2c"
DEFAULT_PER_DEVICE_TIMEOUT = 2
DEFAULT_MAX_DEVICES = 50

NOOP_RESOURCE = "dms_identity"


class NtcipDms(BaseResourceRunner):
    # Read-only property: this runner only ever performs SNMP GET, never
    # SET, so every resource here is a poll target, never a command.
    resources = {
        name: {
            "doc_params": ["devices (optional list of configured device names; default all)"],
            "doc_returns": columns,
            "example": json.dumps({"resource": name}),
        }
        for name, columns in RESOURCE_COLUMNS.items()
    }

    noop_query = json.dumps({"resource": NOOP_RESOURCE})

    @classmethod
    def name(cls):
        return "NTCIP 1203 DMS"

    @classmethod
    def type(cls):
        return "ntcip_dms"

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            {
                "community": {
                    "type": "string",
                    "title": "SNMP Community String",
                    "description": (
                        "The SNMP community string used to authenticate to each sign. "
                        "SNMP v1 and v2c send this in plain text on the wire, with no "
                        "encryption, so anyone able to observe the network path to a "
                        "device can read it. Only use this connector on a network "
                        "isolated from untrusted traffic (a private VLAN or a VPN), "
                        "never across the open internet."
                    ),
                },
                "snmp_version": {
                    "type": "string",
                    "title": "SNMP Version",
                    "default": DEFAULT_SNMP_VERSION,
                    "enum": ["2c", "1"],
                    "description": (
                        "v1 and v2c differ in how a device reports a missing object, so "
                        "this is a fixed choice, never auto-detected: guessing the "
                        "version from a timeout would misdiagnose an unreachable device "
                        "as a version mismatch."
                    ),
                },
                "default_devices": {
                    "type": "string",
                    "title": "Devices (JSON)",
                    "description": (
                        "A JSON list of the signs to poll, one object per device: "
                        '[{"name": "I-5 NB MP12", "host": "10.0.1.20", "port": 161}]. '
                        '"port" defaults to 161 when omitted. This list is the only '
                        "source of poll targets; a query can select a subset of these "
                        "devices by name but cannot supply a host or port of its own."
                    ),
                },
                "per_device_timeout": {
                    "type": "number",
                    "title": "Per-Device Timeout (seconds)",
                    "default": DEFAULT_PER_DEVICE_TIMEOUT,
                },
                "max_devices": {
                    "type": "number",
                    "title": "Max Devices Polled",
                    "default": DEFAULT_MAX_DEVICES,
                },
            },
            required=["community", "default_devices"],
            secret=["community"],
        )

    def __init__(self, configuration):
        super().__init__(configuration)
        self.community = self.configuration.get("community", "")
        self.snmp_version = self.configuration.get("snmp_version", DEFAULT_SNMP_VERSION)
        self.per_device_timeout = self.configuration.get("per_device_timeout", DEFAULT_PER_DEVICE_TIMEOUT)
        self.max_devices = self.configuration.get("max_devices", DEFAULT_MAX_DEVICES)
        # Validation failures surface later, when run_query/test_connection
        # land: they return (None, self.devices_error) rather than raising
        # here, matching every other connector's "fail at query time with a
        # clear message" contract.
        self.devices, self.devices_error = validate_devices(self.configuration.get("default_devices", "[]"))
        # Validated alongside the device list, in __init__, for the same
        # reason: run_query/test_connection fail at query time with a clear
        # message rather than raising here.
        self.limits_error = validate_polling_limits(self.per_device_timeout, self.max_devices)

    def run_query(self, query, user):
        # Both checked, not just devices_error: the review-fix commit added
        # limits_error beside it for the numeric max_devices/per_device_timeout
        # validation, and a runner that only checks devices_error lets a bad
        # limit reach poll_devices instead of failing at query time.
        if self.devices_error:
            return None, self.devices_error
        if self.limits_error:
            return None, self.limits_error

        # The guards this runner used to carry inline now live in
        # parse_object_query, which the whole connector family shares. The
        # error wording is unchanged: it was copied from here, because the
        # root guard below was already right and the params one was not
        # (`config.get("params") or {}` turned a `[]` into `{}` before the
        # isinstance check could ever see it).
        config, params, error = parse_object_query(query)
        if error:
            return None, error

        resource = config.get("resource")
        if resource not in RESOURCE_COLUMNS:
            available = ", ".join(sorted(RESOURCE_COLUMNS))
            return None, f"Unknown resource {resource!r}. Available resources: {available}"

        selected, error = select_devices(self.devices, params.get("devices"), self.max_devices)
        if error:
            return None, error

        rows = poll_devices(
            selected,
            resource,
            self.community,
            self.snmp_version,
            self.per_device_timeout,
            self.timeout,
        )

        # The predicate that matters most: any returned table is read as
        # success by the execution layer, so a fleet that is all errors, all
        # skipped, or a mixture of the two must never come back as a table
        # of unhealthy rows reading green. Only "at least one healthy row"
        # earns a real table.
        if not any(row["poll_status"] == "healthy" for row in rows):
            return None, aggregated_error(resource, rows)

        columns, table_rows = to_typed_table(resource, rows)
        return serialize_result(columns, table_rows), None

    def test_connection(self):
        if not self.devices:
            raise Exception("configure at least one device")

        # noop_query alone (no params.devices) would poll every configured
        # device, since absent params.devices means "all". Connection
        # testing is only supposed to reach the first configured device, so
        # the query actually run here restricts to it explicitly rather
        # than using self.noop_query verbatim.
        query = json.dumps({"resource": NOOP_RESOURCE, "params": {"devices": [self.devices[0]["name"]]}})
        data, error = self.run_query(query, None)
        if error is not None:
            raise Exception(error)


register(NtcipDms)
