"""Query rows to a GBFS file set.

Pure, like gtfs_rt_serializer: no database, no HTTP, no clock. The version
decides spellings and shapes; the field vocabulary the column map uses is
version-neutral. Nothing is dropped: a value that cannot honestly become its
field is refused with its row index, and genuine absence stays absent.
"""

import math
from datetime import UTC, datetime
from typing import Any

from veodyn_api.services.gtfs_rt_serializer import SerializationError

SUPPORTED_VERSIONS: tuple[str, ...] = ("2.3", "3.0")

REQUIRED_FIELDS: dict[str, frozenset[str]] = {
    "stations": frozenset(
        {
            "station_id",
            "name",
            "lat",
            "lon",
            "num_vehicles_available",
            "is_installed",
            "is_renting",
            "is_returning",
            "last_reported",
        }
    ),
}

# A key outside this set is refused rather than skipped, which would publish a
# quietly incomplete feed.
SUPPORTED_FIELDS: dict[str, frozenset[str]] = {
    "stations": REQUIRED_FIELDS["stations"] | frozenset({"num_docks_available", "capacity", "address"}),
}

# The keys the binding supplies. 3.0 writes `language` out as `languages`.
SYSTEM_INFO_REQUIRED: dict[str, frozenset[str]] = {
    "2.3": frozenset({"system_id", "language", "name", "timezone"}),
    "3.0": frozenset({"system_id", "language", "name", "timezone", "opening_hours", "feed_contact_email"}),
}

MEMBER_FILES: tuple[str, ...] = ("system_information.json", "station_information.json", "station_status.json")

_INFORMATION_FIELDS = ("name", "lat", "lon", "address", "capacity")
_STATUS_FIELDS = (
    "num_vehicles_available",
    "num_docks_available",
    "is_installed",
    "is_renting",
    "is_returning",
    "last_reported",
)
_FLOAT_FIELDS = frozenset({"lat", "lon"})
_COUNT_FIELDS = frozenset({"num_vehicles_available", "num_docks_available", "capacity"})
_BOOL_FIELDS = frozenset({"is_installed", "is_renting", "is_returning"})

# WGS-84, and the bounds the GBFS schemas put on these two fields.
_COORDINATE_LIMITS: dict[str, float] = {"lat": 90.0, "lon": 180.0}

# The schemas' own floor for a POSIX timestamp field, and a ceiling that keeps
# `datetime.fromtimestamp` from raising OverflowError on the 3.0 path.
_MIN_POSIX = 1450155600
_MAX_POSIX = 2**31 - 1


def check_system_info(version: str, info: dict[str, str]) -> tuple[str, ...]:
    """Every problem with a system_information binding, empty when there is none."""
    required = SYSTEM_INFO_REQUIRED[version]
    missing = sorted(name for name in required if not str(info.get(name) or "").strip())
    unknown = sorted(set(info) - required)
    return tuple(
        [f"system field {name!r} is required for {version}" for name in missing]
        + [f"system field {name!r} is not one this serializer writes" for name in unknown]
    )


def _check_posix(epoch: int, field: str, index: int) -> None:
    """Refused here rather than at the 3.0 formatting, where the row index is gone
    and an out-of-range value raises OverflowError instead of naming the field."""
    if not _MIN_POSIX <= epoch <= _MAX_POSIX:
        raise SerializationError(f"row {index}: {field} value {epoch} is not a POSIX timestamp GBFS accepts")


def _rfc3339(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _localized(text: Any, language: str, version: str) -> Any:
    return [{"text": text, "language": language}] if version == "3.0" else text


def _value(row: dict[str, Any], column: str, field: str, index: int) -> Any:
    """A row's value for one field, coerced to the type GBFS holds, or a refusal."""
    value = row.get(column)
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if field in _FLOAT_FIELDS:
        # bool first: it is an int subclass, so True would coerce to 1.0 and read
        # as a real coordinate.
        if isinstance(value, bool):
            raise SerializationError(f"row {index}: {field} value {value!r} is not a number")
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise SerializationError(f"row {index}: {field} value {value!r} is not a number") from None
        # nan and inf serialize as bare NaN/Infinity, which are not JSON at all.
        if not math.isfinite(number):
            raise SerializationError(f"row {index}: {field} value {value!r} is not a finite number")
        limit = _COORDINATE_LIMITS[field]
        if abs(number) > limit:
            raise SerializationError(f"row {index}: {field} value {number} is outside -{limit}..{limit}")
        return number
    if field in _COUNT_FIELDS or field == "last_reported":
        # bool is an int subclass, and True as a bike count is never what was meant.
        if isinstance(value, bool) or not isinstance(value, int):
            raise SerializationError(f"row {index}: {field} value {value!r} is not an integer")
        if field == "last_reported":
            _check_posix(value, field, index)
        elif value < 0:
            raise SerializationError(f"row {index}: {field} value {value} is negative")
        return value
    if field in _BOOL_FIELDS:
        if isinstance(value, bool):
            return value
        if value in (0, 1):
            return bool(value)
        raise SerializationError(f"row {index}: {field} value {value!r} is not a boolean")
    return str(value)


def serialize_gbfs_stations(
    rows: list[dict[str, Any]],
    column_map: dict[str, str],
    system_info: dict[str, str],
    version: str,
    slug: str,
    origin: str,
    feed_timestamp: int,
) -> dict[str, Any]:
    """The four files of a docked GBFS system, or a SerializationError naming why not."""
    if version not in SUPPORTED_VERSIONS:
        raise SerializationError(f"version {version!r} is not one this serializer writes")
    missing = sorted(REQUIRED_FIELDS["stations"] - set(column_map))
    if missing:
        raise SerializationError(f"column_map is missing required field(s): {', '.join(missing)}")
    unknown = sorted(set(column_map) - SUPPORTED_FIELDS["stations"])
    if unknown:
        raise SerializationError(f"column_map names field(s) this serializer does not write: {', '.join(unknown)}")
    problems = check_system_info(version, system_info)
    if problems:
        raise SerializationError("; ".join(problems))
    # -1 because this one is the feed's own clock, not a row's value.
    _check_posix(feed_timestamp, "feed_timestamp", -1)

    language = system_info["language"]
    information: list[dict[str, Any]] = []
    status: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for index, row in enumerate(rows):
        values = {field: _value(row, column, field, index) for field, column in column_map.items()}
        for field in sorted(REQUIRED_FIELDS["stations"]):
            if values.get(field) is None:
                raise SerializationError(f"row {index}: required field {field} is blank")
        station_id = str(values["station_id"])
        if station_id in seen_ids:
            raise SerializationError(f"row {index}: duplicate station_id {station_id!r}")
        seen_ids.add(station_id)

        info_entry: dict[str, Any] = {"station_id": station_id}
        for field in _INFORMATION_FIELDS:
            if values.get(field) is None:
                continue
            info_entry[field] = _localized(values[field], language, version) if field == "name" else values[field]
        information.append(info_entry)

        status_entry: dict[str, Any] = {"station_id": station_id}
        for field in _STATUS_FIELDS:
            if values.get(field) is None:
                continue
            spelled = field
            if field == "num_vehicles_available" and version == "2.3":
                spelled = "num_bikes_available"
            value = values[field]
            if field == "last_reported" and version == "3.0":
                value = _rfc3339(value)
            status_entry[spelled] = value
        status.append(status_entry)

    stamp: Any = _rfc3339(feed_timestamp) if version == "3.0" else feed_timestamp
    system: dict[str, Any] = {
        "system_id": system_info["system_id"],
        "name": _localized(system_info["name"], language, version),
        "timezone": system_info["timezone"],
    }
    if version == "3.0":
        system["languages"] = [language]
        system["opening_hours"] = system_info["opening_hours"]
        system["feed_contact_email"] = system_info["feed_contact_email"]
    else:
        system["language"] = language

    def wrap(data: dict[str, Any]) -> dict[str, Any]:
        return {"last_updated": stamp, "ttl": 0, "version": version, "data": data}

    feeds = [
        {"name": name.removesuffix(".json"), "url": f"{origin}/api/public/feeds/{slug}/{name}"}
        for name in MEMBER_FILES
    ]
    discovery_data: dict[str, Any] = {"feeds": feeds} if version == "3.0" else {language: {"feeds": feeds}}

    return {
        "gbfs.json": wrap(discovery_data),
        "system_information.json": wrap(system),
        "station_information.json": wrap({"stations": information}),
        "station_status.json": wrap({"stations": status}),
    }
