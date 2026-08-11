"""
Row and column shape for the NTCIP DMS runner's three resources.

Split out of `ntcip_dms_poll.py`, which owns the SNMP transport and the
deadline loop, to keep both files under the repo's 300-line limit and to
give this fix its own seam. `RESOURCE_COLUMN_TYPES` declares a fixed type
per column rather than letting `connector_base.to_redash_table` infer one
from whichever row happens to be first: a device that errors or is skipped
decodes every field to None, so inference from the first record would type
a numeric column like height_mm or brightness_level as a string whenever
the first row in a table is unhealthy. `to_typed_table` below is what
`ntcip_dms.py` calls instead of `connector_base.to_redash_table`.
"""

from redash.query_runner import TYPE_INTEGER, TYPE_STRING
from redash.query_runner.connector_tables import to_fixed_table
from redash.query_runner.ntcip_dms_decode import (
    decode_dms_identity,
    decode_dms_message,
    decode_dms_status,
)

DECODE_FUNCS = {
    "dms_identity": decode_dms_identity,
    "dms_status": decode_dms_status,
    "dms_message": decode_dms_message,
}

# The fixed column set per resource, exactly as the spec's table declares
# it and matching each decode function's own return keys (checked: every
# key a decode function returns appears here, and no others). Every row
# built by this module, healthy, error or skipped alike, starts from one of
# these templates, so the first row in a result table never has a narrower
# key set than a later one.
RESOURCE_COLUMNS = {
    "dms_identity": [
        "device",
        "host",
        "sys_name",
        "sys_descr",
        "sign_type",
        "height_mm",
        "width_mm",
        "height_px",
        "width_px",
        "poll_status",
        "error",
    ],
    "dms_status": [
        "device",
        "host",
        "door_open",
        "door_open_raw",
        "error_status",
        "error_status_raw",
        "brightness_level",
        "brightness_levels_total",
        "poll_status",
        "error",
    ],
    "dms_message": [
        "device",
        "host",
        "message_multi",
        "message_text",
        "message_status",
        "message_status_raw",
        "message_source",
        "poll_status",
        "error",
    ],
}

# Declared per-column type, read by to_typed_table instead of inferred from
# a sample row. door_open and error_status decode to a list of bit names
# (see ntcip_dms_decode.decode_door_open/decode_short_error_status), which
# to_typed_table flattens to a JSON string the same way connector_base did,
# so they are typed as strings here, not a list type no Redash column type
# covers.
RESOURCE_COLUMN_TYPES = {
    "dms_identity": {
        "device": TYPE_STRING,
        "host": TYPE_STRING,
        "sys_name": TYPE_STRING,
        "sys_descr": TYPE_STRING,
        "sign_type": TYPE_STRING,
        "height_mm": TYPE_INTEGER,
        "width_mm": TYPE_INTEGER,
        "height_px": TYPE_INTEGER,
        "width_px": TYPE_INTEGER,
        "poll_status": TYPE_STRING,
        "error": TYPE_STRING,
    },
    "dms_status": {
        "device": TYPE_STRING,
        "host": TYPE_STRING,
        "door_open": TYPE_STRING,
        "door_open_raw": TYPE_INTEGER,
        "error_status": TYPE_STRING,
        "error_status_raw": TYPE_INTEGER,
        "brightness_level": TYPE_INTEGER,
        "brightness_levels_total": TYPE_INTEGER,
        "poll_status": TYPE_STRING,
        "error": TYPE_STRING,
    },
    "dms_message": {
        "device": TYPE_STRING,
        "host": TYPE_STRING,
        "message_multi": TYPE_STRING,
        "message_text": TYPE_STRING,
        "message_status": TYPE_STRING,
        "message_status_raw": TYPE_INTEGER,
        "message_source": TYPE_STRING,
        "poll_status": TYPE_STRING,
        "error": TYPE_STRING,
    },
}


def blank_row(resource, device, poll_status, error):
    row = dict.fromkeys(RESOURCE_COLUMNS[resource], None)
    row["device"] = device["name"]
    row["host"] = device["host"]
    row["poll_status"] = poll_status
    row["error"] = error
    return row


def healthy_row(resource, device, values):
    row = blank_row(resource, device, "healthy", None)
    row.update(DECODE_FUNCS[resource](values))
    return row


def to_typed_table(resource, rows):
    """
    Fixed columns and types for one resource. The generic implementation is
    connector_tables.to_fixed_table; this keeps the resource-keyed signature
    the runner calls.
    """
    return to_fixed_table(RESOURCE_COLUMNS[resource], RESOURCE_COLUMN_TYPES[resource], rows)
