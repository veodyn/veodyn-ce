"""
Configuration validation for the NTCIP 1203 DMS runner.

Split out of `ntcip_dms.py` to keep that file under the repo's 300-line
limit. Both functions here are pure: given already-loaded configuration
values, they return (value, error) or an error string, never raise, so
`ntcip_dms.py`'s `__init__` can store the result and let `run_query`/
`test_connection` fail at query time with a clear message, matching every
other connector's contract.
"""

import json

DEFAULT_PORT = 161

MIN_PORT = 1
MAX_PORT = 65535


def _device_label(entry, index):
    """
    Name a device for an error message: its own "name" when it has one and
    is a string, its position in the list otherwise. A JSON blob of many
    devices with a single bad row is unreadable without this: the operator
    saving the data source needs to know which row to fix.
    """
    if isinstance(entry, dict):
        name = entry.get("name")
        if isinstance(name, str) and name.strip():
            return f"'{name}'"
    return f"device at index {index}"


def validate_devices(raw_devices):
    """
    Parse and validate the `default_devices` configuration text.

    Returns (devices, error). On success, devices is a list of
    {"name", "host", "port"} dicts with "port" defaulted to 161 where
    omitted, and error is None. On failure, devices is None and error is a
    string that names the offending device, by name where one was given, by
    list index otherwise.

    An empty list is rejected here, not accepted as a no-op: at least one
    configured device is required for the data source to pass connection
    testing.
    """
    try:
        parsed = json.loads(raw_devices)
    except (TypeError, json.JSONDecodeError) as e:
        return None, f"default_devices: invalid JSON ({e})"

    if not isinstance(parsed, list):
        return None, "default_devices: must be a JSON list of devices"

    if not parsed:
        return None, "default_devices: at least one device is required"

    devices = []
    for index, entry in enumerate(parsed):
        label = _device_label(entry, index)

        if not isinstance(entry, dict):
            return None, f"default_devices: {label} must be a JSON object"

        name = entry.get("name")
        if not isinstance(name, str) or not name.strip():
            return None, f"default_devices: {label} is missing a 'name'"

        host = entry.get("host")
        if not isinstance(host, str) or not host.strip():
            return None, f"default_devices: '{name}' is missing a 'host'"

        port = entry.get("port", DEFAULT_PORT)
        # bool is a subclass of int in Python, so True/False would otherwise
        # slip past an isinstance(port, int) check as valid ports.
        if isinstance(port, bool) or not isinstance(port, int):
            return None, f"default_devices: '{name}' has a non-integer port"
        if not (MIN_PORT <= port <= MAX_PORT):
            return None, f"default_devices: '{name}' has a port outside 1-65535"

        devices.append({"name": name, "host": host, "port": port})

    # Duplicate names are a cross-device check, so it runs as a second pass
    # once every row has already been confirmed individually well-formed.
    seen_names = set()
    for device in devices:
        if device["name"] in seen_names:
            return None, f"default_devices: '{device['name']}' is a duplicate device name"
        seen_names.add(device["name"])

    return devices, None


def validate_polling_limits(per_device_timeout, max_devices):
    """
    Validate the two numeric polling controls the configuration schema
    types as "number" but never actually constrains.

    A fractional max_devices breaks the plain list slice it drives
    (`devices[:max_devices]`), and zero or a negative max_devices inverts
    the cap: it turns "poll at most N devices" into "poll nothing" or,
    with slicing's negative-index behavior, "poll all but the last N".
    A non-positive per_device_timeout has no sane meaning against an SNMP
    library call that takes it as a wait duration.

    Returns None on success, an error string naming the offending field
    and value otherwise. bool is a subclass of int in Python, so it is
    excluded explicitly the same way validate_devices excludes it for
    port, or True/False would slip past an isinstance(x, int) check.
    """
    if isinstance(max_devices, bool) or not isinstance(max_devices, int) or max_devices < 1:
        return f"max_devices: must be a positive integer, got {max_devices!r}"
    if isinstance(per_device_timeout, bool) or not isinstance(per_device_timeout, int) or per_device_timeout <= 0:
        return f"per_device_timeout: must be a positive integer, got {per_device_timeout!r}"
    return None
