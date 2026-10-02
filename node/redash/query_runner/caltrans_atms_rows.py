"""
Column shape and row shaping for the `caltrans_atms` runner's resources.

Split from `caltrans_atms.py` for the repo's 300-line limit, along the same
seam `tmdd_rows.py` uses for TMDD: a fixed column set per resource
(`connector_tables.to_fixed_table` reads these), plus the pure
record -> row transform, kept apart from the HTTP transport and the text
parsers (`caltrans_atms_parse.py`).
"""

from redash.query_runner import (
    TYPE_DATETIME,
    TYPE_FLOAT,
    TYPE_INTEGER,
    TYPE_STRING,
)

# The documented color_code -> speed-range legend (13/1/3/2). Everything
# else, including the undocumented 0 and 9 seen live, is "no_data": see
# caltrans_atms.py's module docstring and Decision 4 of the design spec.
OK_COLOR_CODES = {"13", "1", "3", "2"}

STATIONS_COLUMNS = ("vds_id", "name", "route", "direction", "postmile", "lon", "lat")
STATIONS_COLUMN_TYPES = {
    "vds_id": TYPE_STRING,
    "name": TYPE_STRING,
    "route": TYPE_STRING,
    "direction": TYPE_STRING,
    "postmile": TYPE_FLOAT,
    "lon": TYPE_FLOAT,
    "lat": TYPE_FLOAT,
}

READINGS_COLUMNS = (
    "vds_id",
    "status",
    "color_code",
    "speed_mph",
    "volume_per_30s",
    "good_lanes_pct",
    "observed_at",
)
READINGS_COLUMN_TYPES = {
    "vds_id": TYPE_STRING,
    "status": TYPE_STRING,
    "color_code": TYPE_STRING,
    "speed_mph": TYPE_FLOAT,
    "volume_per_30s": TYPE_INTEGER,
    "good_lanes_pct": TYPE_FLOAT,
    "observed_at": TYPE_DATETIME,
}

RESOURCE_COLUMNS = {"stations": STATIONS_COLUMNS, "readings": READINGS_COLUMNS}
RESOURCE_COLUMN_TYPES = {"stations": STATIONS_COLUMN_TYPES, "readings": READINGS_COLUMN_TYPES}


def _to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def reading_row(raw, observed_at):
    """
    Shape one raw webupdate.txt record (vds_id/color_code/speed/volume/
    good_lanes strings) into a `readings` row. `speed_mph` always carries
    whatever Caltrans sent, verbatim: no color-range midpoint is invented
    for an `ok` row, and nothing is nulled out for a `no_data` one, the
    raw field is what it is, `status` is what says whether to trust it.
    """
    color_code = raw["color_code"]
    return {
        "vds_id": raw["vds_id"],
        "status": "ok" if color_code in OK_COLOR_CODES else "no_data",
        "color_code": color_code,
        "speed_mph": _to_float(raw["speed"]),
        "volume_per_30s": _to_int(raw["volume"]),
        "good_lanes_pct": _to_float(raw["good_lanes"]),
        "observed_at": observed_at,
    }
