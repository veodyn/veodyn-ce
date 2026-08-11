"""
Column shape and enumeration vocabulary for the TMDD runner's resources.

Data only. Nothing here parses XML; `tmdd_decode` reads these tables and
`connector_tables.to_fixed_table` reads the column ones. Split from the
decoder for the repo's 300-line limit, along the seam that costs least: the
enumerations are long because every value is transcribed verbatim, and none
of it is logic.

**A fixed column set, not one inferred from the first record.**
`connector_base.to_redash_table` derives both the columns and their types
from record one. A TMDD response commonly leads with its sparsest device (a
sign with no route designator and no direction, both `minOccurs="0"`), so
inference would drop those columns for the whole table. Every record the
decoder returns therefore carries every key declared here, `None` included.

**An enumerated value is carried verbatim, and gets no `_raw` sibling.** 88
of `TMDD.xsd`'s 207 named simple types are unions of a bounded integer and a
string enumeration, and the schema asserts no mapping between the two forms.
`Time-reference-code` settles that it cannot be inferred either: 4 integers
against 5 strings, so there is no positional mapping to guess at. The tables
below therefore validate and nothing more. A `_raw` sibling exists only where
a real transformation happens, which in this connector is coordinates.
"""

from collections import namedtuple

from redash.query_runner import (
    TYPE_BOOLEAN,
    TYPE_DATETIME,
    TYPE_FLOAT,
    TYPE_INTEGER,
    TYPE_STRING,
)

__all__ = ["ENUMERATIONS", "RESOURCE_COLUMNS", "RESOURCE_COLUMN_TYPES", "Enumeration"]

# `integers` is the inclusive (min, max) of the union's integer arm. Only
# Link-direction starts at 0. The two arms are independent: their counts
# agree for every type here, and Time-reference-code elsewhere in the bundle
# proves that agreement is a coincidence rather than a rule.
Enumeration = namedtuple("Enumeration", "values integers")

ENUMERATIONS = {
    "Device-type": Enumeration(
        (
            "detector",
            "cctv camera",
            "dynamic message sign",
            "environmental sensor station",
            "gate",
            "highway advisory radio",
            "lane control signal",
            "ramp meter",
            "signal controller",
            "signal section",
            "video switch",
            "other",
        ),
        (1, 12),
    ),
    "Device-information-type": Enumeration(
        (
            "device inventory",
            "device status",
            "device schedule",
            "device plan",
            "device maintenance history",
            "device data",
            "device metadata",
            "message appearance",
            "device font table",
            "other",
        ),
        (1, 10),
    ),
    "Event-request-focus": Enumeration(
        (
            "specific events",
            "specific response plans",
            "all current events",
            "all event updates",
            "all response plans",
            "other",
        ),
        (1, 6),
    ),
    "Event-severity": Enumeration(("none", "minor", "major", "natural disaster", "other"), (1, 5)),
    "Event-category": Enumeration(("planned", "current", "forecast"), (1, 3)),
    "Link-direction": Enumeration(
        (
            "any other",
            "n",
            "ne",
            "e",
            "se",
            "s",
            "sw",
            "w",
            "nw",
            "not directional",
            "positive direction",
            "negative direction",
            "both directions",
            "other",
        ),
        (0, 13),
    ),
    "Device-operational-status": Enumeration(
        ("on", "off", "out of service", "unavailable", "unknown", "marginal", "failed", "other"),
        (1, 8),
    ),
    "Event-incident-status": Enumeration(
        (
            "planned",
            "forecast",
            "contingency plan",
            "response plan activated",
            "reported",
            "confirmed",
            "responding",
            "current",
            "updated",
            "clearing",
            "ended",
            "delete",
            "cancelled",
            "postponed",
            "reopened",
            "new",
            "other",
        ),
        (1, 17),
    ),
}

RESOURCE_COLUMNS = {
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
    "dms_status": [
        "device_id",
        "oper_status",
        "current_message",
        "beacon_on",
        "last_update",
    ],
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

# `descriptions`, `locations` and `update_times` hold a JSON document, so
# they are typed as strings: no Redash column type covers an array, and
# to_fixed_table would otherwise re-encode an already-encoded value. The
# timestamp columns hold an ISO-8601 string assembled from the composite
# DateTimeZone, which is what a datetime column carries once a result set is
# serialised anyway.
_COORDINATES = {
    "latitude": TYPE_FLOAT,
    "longitude": TYPE_FLOAT,
    "latitude_raw": TYPE_INTEGER,
    "longitude_raw": TYPE_INTEGER,
}

RESOURCE_COLUMN_TYPES = {
    "dms_inventory": {
        "device_id": TYPE_STRING,
        "device_name": TYPE_STRING,
        "device_type": TYPE_STRING,
        "roadway": TYPE_STRING,
        "direction": TYPE_STRING,
        **_COORDINATES,
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
        **_COORDINATES,
        "start_time": TYPE_DATETIME,
        "update_time": TYPE_DATETIME,
    },
}
