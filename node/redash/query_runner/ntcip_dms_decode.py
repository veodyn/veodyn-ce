"""
Pure decode layer for NTCIP 1203 DMS objects.

Every OID, enum, and bit meaning here is taken from
`docs/superpowers/specs/2026-08-04-ntcip-1203-oid-matrix.md`, the artifact
built specifically so this module does not have to retype values from
memory or from general NTCIP knowledge. Where the matrix itself flags a
correction against a plausible-but-wrong name, that correction is repeated
below at the point it matters, not just in the matrix.

This module does no network I/O. It takes already-fetched varbind values
(whatever the transport layer got back from an SNMP GET, keyed by the field
names in `OIDS`) and returns row dicts matching the fixed result schemas in
`docs/superpowers/specs/2026-08-04-tmdd-ntcip-connectors-design.md`, minus
the `device`/`host`/`poll_status`/`error` columns the polling loop owns.
That purity is deliberate: it is what makes OID/enum/bitmap decoding
testable without a live device or even a stubbed transport.

Missing values: a v2c GET of an OID a device does not serve does not raise.
The varbind's value comes back as a typed sentinel,
`pysnmp.proto.rfc1905.NoSuchObject` or `NoSuchInstance` (confirmed against a
real agent in Task 1; see that task's report for the exact shape). Every
decode function here branches on `isinstance` against those types, never on
`repr()` or `str()` of the value, and a missing value always becomes `None`
in the row, never an exception and never a fabricated zero.
"""

# pysnmp is a required dependency of this adapter, not an optional one: Task 1
# added it to the all_ds group precisely so it is always present, and Task 4's
# transport imports it unconditionally too. There is no supported execution
# path where this import legitimately fails, so it is not wrapped: a missing
# pysnmp must fail loudly at import time, not degrade this module into
# treating every missing value as present.
from pysnmp.proto.rfc1905 import NoSuchInstance, NoSuchObject

_PYSNMP_SENTINELS = (NoSuchObject, NoSuchInstance)

# Field names below are the matrix's object names, snake-cased. Each maps to
# the full numeric OID including the instance suffix: ".0" for a scalar,
# an explicit table index for a table column. Two of these (sys_name,
# sys_descr) are RFC 1213 MIB-II objects, not NTCIP 1203 ones; the matrix
# supplies their well-known OIDs from outside the standard rather than
# hunting for them in the 1203 text.
OIDS = {
    "sys_name": "1.3.6.1.2.1.1.5.0",
    "sys_descr": "1.3.6.1.2.1.1.1.0",
    "dms_sign_type": "1.3.6.1.4.1.1206.4.2.3.1.2.0",
    "dms_sign_height": "1.3.6.1.4.1.1206.4.2.3.1.3.0",
    "dms_sign_width": "1.3.6.1.4.1.1206.4.2.3.1.4.0",
    "vms_sign_height_pixels": "1.3.6.1.4.1.1206.4.2.3.2.3.0",
    "vms_sign_width_pixels": "1.3.6.1.4.1.1206.4.2.3.2.4.0",
    "dms_stat_door_open": "1.3.6.1.4.1.1206.4.2.3.9.6.0",
    "short_error_status": "1.3.6.1.4.1.1206.4.2.3.9.7.1.0",
    # dmsIllumBrightLevelStatus, not "dmsIllumBrightnessLevel": that object
    # does not exist in v03f. dmsIllumBrightnessValues (not used here) is a
    # different object entirely, an OCTET STRING photocell curve table.
    "dms_illum_bright_level_status": "1.3.6.1.4.1.1206.4.2.3.7.5.0",
    "dms_illum_num_bright_levels": "1.3.6.1.4.1.1206.4.2.3.7.4.0",
    "dms_msg_table_source": "1.3.6.1.4.1.1206.4.2.3.6.5.0",
    # The currentBuffer row (dmsMessageMemoryType=5, dmsMessageNumber=1) of
    # dmsMessageTable, which is indexed by {dmsMessageMemoryType,
    # dmsMessageNumber}. This is not a bare column read: "current message"
    # is defined as this specific table row, not a scalar object.
    "dms_message_multi_string": "1.3.6.1.4.1.1206.4.2.3.5.8.1.3.5.1",
    "dms_message_status": "1.3.6.1.4.1.1206.4.2.3.5.8.1.9.5.1",
}

# Which fields the polling loop needs per resource, so the OID list to fetch
# and the decode function that consumes the result stay driven by the same
# table instead of two hand-kept lists drifting apart.
RESOURCE_FIELDS = {
    "dms_identity": [
        "sys_name",
        "sys_descr",
        "dms_sign_type",
        "dms_sign_height",
        "dms_sign_width",
        "vms_sign_height_pixels",
        "vms_sign_width_pixels",
    ],
    "dms_status": [
        "dms_stat_door_open",
        "short_error_status",
        "dms_illum_bright_level_status",
        "dms_illum_num_bright_levels",
    ],
    "dms_message": [
        "dms_msg_table_source",
        "dms_message_multi_string",
        "dms_message_status",
    ],
}

# dmsSignType enumeration.
SIGN_TYPE_NAMES = {
    1: "other",
    2: "bos",
    3: "cms",
    4: "vmsChar",
    5: "vmsLine",
    6: "vmsFull",
    129: "portableOther",
    130: "portableBOS",
    131: "portableCMS",
    132: "portableVMSChar",
    133: "portableVMSLine",
    134: "portableVMSFull",
}

# dmsMessageStatus enumeration.
MESSAGE_STATUS_NAMES = {
    1: "notUsed",
    2: "modifying",
    3: "validating",
    4: "valid",
    5: "error",
    6: "modifyReq",
    7: "validateReq",
    8: "notUsedReq",
}

# shortErrorStatus bit meanings, standardized by the matrix's own bit table
# (unlike dmsStatDoorOpen below, which is manufacturer-specific). Bit 0 is
# reserved (the retired "other" value, no longer allowed) and is
# intentionally absent, so it never produces a name.
SHORT_ERROR_STATUS_BITS = [
    (1, "communications_error"),
    (2, "power_error"),
    (3, "attached_device_error"),
    (4, "lamp_error"),
    (5, "pixel_error"),
    (6, "photocell_error"),
    (7, "message_error"),
    (8, "controller_error"),
    (9, "temperature_warning"),
    (10, "climate_control_error"),
    (11, "critical_temperature_error"),
    (12, "drum_rotor_error"),
    (13, "door_open"),
    (14, "humidity_warning"),
]


def _is_missing(value):
    if value is None:
        return True
    return isinstance(value, _PYSNMP_SENTINELS)


def _decode_int(value):
    if _is_missing(value):
        return None
    return int(value)


def _decode_str(value):
    if _is_missing(value):
        return None
    return str(value)


def decode_sign_type(value):
    raw = _decode_int(value)
    if raw is None:
        return None
    return SIGN_TYPE_NAMES.get(raw, f"unknown({raw})")


def decode_message_status(value):
    raw = _decode_int(value)
    if raw is None:
        return None
    return MESSAGE_STATUS_NAMES.get(raw, f"unknown({raw})")


def decode_door_open(value):
    """
    Which bits of dmsStatDoorOpen are set, as a list of bit positions
    (0-7). The standard states the bit-door correlation order is
    "specified by manufacturer", so a bit index cannot be turned into a
    physical door name here; that mapping needs the device's own manual.
    """
    raw = _decode_int(value)
    if raw is None:
        return None
    return [bit for bit in range(8) if raw & (1 << bit)]


def decode_short_error_status(value):
    raw = _decode_int(value)
    if raw is None:
        return None
    return [name for bit, name in SHORT_ERROR_STATUS_BITS if raw & (1 << bit)]


def _render_multi_tag(tag_content):
    """Render one MULTI tag's contribution to plain text, or "" if the tag
    carries no text of its own (page time, line justification, colour,
    font, and anything else not explicitly a line/page break)."""
    lowered = tag_content.lower()
    if lowered.startswith("nl"):
        return "\n"
    if lowered.startswith("np"):
        return "\f"
    return ""


def decode_multi(raw):
    """
    Decode a MULTI string into plain text: [nl] and [np] become line/page
    breaks, [pt..] and [jl..] (and colour/font tags) are dropped, and any
    other bracketed tag is dropped too rather than raising on the unknown
    name. Returns None, never an exception, for malformed input: an
    unclosed tag, a nested tag, or a stray closing bracket with no
    matching open.
    """
    if raw is None:
        return None

    parts = []
    in_tag = False
    tag_chars = []
    for ch in raw:
        if ch == "[":
            if in_tag:
                return None
            in_tag = True
            tag_chars = []
        elif ch == "]":
            if not in_tag:
                return None
            in_tag = False
            rendered = _render_multi_tag("".join(tag_chars))
            if rendered:
                parts.append(rendered)
        elif in_tag:
            tag_chars.append(ch)
        else:
            parts.append(ch)

    if in_tag:
        return None
    return "".join(parts)


def decode_dms_identity(values):
    return {
        "sys_name": _decode_str(values.get("sys_name")),
        "sys_descr": _decode_str(values.get("sys_descr")),
        "sign_type": decode_sign_type(values.get("dms_sign_type")),
        "height_mm": _decode_int(values.get("dms_sign_height")),
        "width_mm": _decode_int(values.get("dms_sign_width")),
        "height_px": _decode_int(values.get("vms_sign_height_pixels")),
        "width_px": _decode_int(values.get("vms_sign_width_pixels")),
    }


def decode_dms_status(values):
    door_raw = values.get("dms_stat_door_open")
    error_raw = values.get("short_error_status")
    return {
        "door_open": decode_door_open(door_raw),
        "door_open_raw": _decode_int(door_raw),
        "error_status": decode_short_error_status(error_raw),
        "error_status_raw": _decode_int(error_raw),
        "brightness_level": _decode_int(values.get("dms_illum_bright_level_status")),
        "brightness_levels_total": _decode_int(values.get("dms_illum_num_bright_levels")),
    }


def decode_dms_message(values):
    raw_multi = values.get("dms_message_multi_string")
    if _is_missing(raw_multi):
        message_multi = None
        message_text = None
    else:
        message_multi = str(raw_multi)
        message_text = decode_multi(message_multi)

    status_raw = values.get("dms_message_status")
    return {
        "message_multi": message_multi,
        "message_text": message_text,
        "message_status": decode_message_status(status_raw),
        "message_status_raw": _decode_int(status_raw),
        # MessageIDCode is not further decoded by the matrix (no INTEGER vs.
        # OCTET STRING call made there), so this is the value's string
        # representation, which pysnmp's scalar types support uniformly
        # regardless of the underlying ASN.1 type, rather than assuming
        # INTEGER and risking int() raising on an octet-string-shaped value.
        "message_source": _decode_str(values.get("dms_msg_table_source")),
    }
