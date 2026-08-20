"""Query rows to a GBFS file set.

Pure, like gtfs_rt_serializer: no database, no HTTP, no clock. The version
decides spellings and shapes; the field vocabulary the column map uses is
version-neutral. Nothing is dropped: a value that cannot honestly become its
field is refused with its row index, and genuine absence stays absent.

Two shapes, each with its own file set: `stations` for a docked system,
`vehicles` for a free-floating one.
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
    "vehicles": frozenset({"vehicle_id", "lat", "lon", "is_reserved", "is_disabled", "last_reported"}),
}

# A key outside this set is refused rather than skipped, which would publish a
# quietly incomplete feed. `vehicle_type_id` is outside it: it names a
# vehicle_types.json nothing here writes.
SUPPORTED_FIELDS: dict[str, frozenset[str]] = {
    "stations": REQUIRED_FIELDS["stations"] | frozenset({"num_docks_available", "capacity", "address"}),
    "vehicles": REQUIRED_FIELDS["vehicles"] | frozenset({"current_range_meters"}),
}

# The keys the binding supplies. 3.0 writes `language` out as `languages`.
SYSTEM_INFO_REQUIRED: dict[str, frozenset[str]] = {
    "2.3": frozenset({"system_id", "language", "name", "timezone"}),
    "3.0": frozenset({"system_id", "language", "name", "timezone", "opening_hours", "feed_contact_email"}),
}

_SYSTEM_FILE = "system_information.json"
_STATION_FILES = ("station_information.json", "station_status.json")
# 3.0 renamed the free-floating status file, its data key and its id field
# together; 2.3 spells all three the older way.
_VEHICLE_FILE: dict[str, str] = {"2.3": "free_bike_status.json", "3.0": "vehicle_status.json"}
_VEHICLE_KEY: dict[str, str] = {"2.3": "bikes", "3.0": "vehicles"}
_VEHICLE_ID: dict[str, str] = {"2.3": "bike_id", "3.0": "vehicle_id"}

_ID_FIELDS: dict[str, str] = {"stations": "station_id", "vehicles": "vehicle_id"}

# The shapes this module writes, which is what `REQUIRED_FIELDS` is keyed by.
SHAPES: frozenset[str] = frozenset(REQUIRED_FIELDS)

_INFORMATION_FIELDS = ("name", "lat", "lon", "address", "capacity")
_STATUS_FIELDS = (
    "num_vehicles_available",
    "num_docks_available",
    "is_installed",
    "is_renting",
    "is_returning",
    "last_reported",
)
_VEHICLE_FIELDS = ("lat", "lon", "is_reserved", "is_disabled", "current_range_meters", "last_reported")
_FLOAT_FIELDS = frozenset({"lat", "lon", "current_range_meters"})
_COUNT_FIELDS = frozenset({"num_vehicles_available", "num_docks_available", "capacity"})
_BOOL_FIELDS = frozenset({"is_installed", "is_renting", "is_returning", "is_reserved", "is_disabled"})

# WGS-84, and the bounds the GBFS schemas put on these two fields.
_COORDINATE_LIMITS: dict[str, float] = {"lat": 90.0, "lon": 180.0}

# The schemas' own floor for a POSIX timestamp field, and a ceiling that keeps
# `datetime.fromtimestamp` from raising OverflowError on the 3.0 path.
_MIN_POSIX = 1450155600
_MAX_POSIX = 2**31 - 1


def member_files(shape: str, version: str) -> tuple[str, ...]:
    """The files a shape publishes under `version`, the discovery document aside.

    Both arguments are checked here as well as in `serialize_gbfs`, because a
    shape falling through to the free-floating branch would answer for a name
    nothing writes.
    """
    if shape not in SHAPES:
        raise SerializationError(f"shape {shape!r} is not one this serializer writes")
    if version not in SUPPORTED_VERSIONS:
        raise SerializationError(f"version {version!r} is not one this serializer writes")
    rest = _STATION_FILES if shape == "stations" else (_VEHICLE_FILE[version],)
    return (_SYSTEM_FILE, *rest)


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
        limit = _COORDINATE_LIMITS.get(field)
        if limit is not None and abs(number) > limit:
            raise SerializationError(f"row {index}: {field} value {number} is outside -{limit}..{limit}")
        if field == "current_range_meters" and number < 0:
            raise SerializationError(f"row {index}: {field} value {number} is negative")
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


def _row_values(shape: str, rows: list[dict[str, Any]], column_map: dict[str, str]) -> list[dict[str, Any]]:
    """Every row's coerced fields, refusing a blank required one or a repeated id."""
    id_field = _ID_FIELDS[shape]
    coerced: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for index, row in enumerate(rows):
        values = {field: _value(row, column, field, index) for field, column in column_map.items()}
        for field in sorted(REQUIRED_FIELDS[shape]):
            if values.get(field) is None:
                raise SerializationError(f"row {index}: required field {field} is blank")
        entity_id = str(values[id_field])
        if entity_id in seen_ids:
            raise SerializationError(f"row {index}: duplicate {id_field} {entity_id!r}")
        seen_ids.add(entity_id)
        values[id_field] = entity_id
        coerced.append(values)
    return coerced


def _station_files(rows: list[dict[str, Any]], language: str, version: str) -> dict[str, Any]:
    information: list[dict[str, Any]] = []
    status: list[dict[str, Any]] = []
    for values in rows:
        info_entry: dict[str, Any] = {"station_id": values["station_id"]}
        for field in _INFORMATION_FIELDS:
            if values.get(field) is None:
                continue
            info_entry[field] = _localized(values[field], language, version) if field == "name" else values[field]
        information.append(info_entry)

        status_entry: dict[str, Any] = {"station_id": values["station_id"]}
        for field in _STATUS_FIELDS:
            if values.get(field) is None:
                continue
            spelled = "num_bikes_available" if field == "num_vehicles_available" and version == "2.3" else field
            value = _rfc3339(values[field]) if field == "last_reported" and version == "3.0" else values[field]
            status_entry[spelled] = value
        status.append(status_entry)
    return {"station_information.json": {"stations": information}, "station_status.json": {"stations": status}}


def _vehicle_files(rows: list[dict[str, Any]], version: str) -> dict[str, Any]:
    vehicles: list[dict[str, Any]] = []
    for values in rows:
        entry: dict[str, Any] = {_VEHICLE_ID[version]: values["vehicle_id"]}
        for field in _VEHICLE_FIELDS:
            if values.get(field) is None:
                continue
            entry[field] = _rfc3339(values[field]) if field == "last_reported" and version == "3.0" else values[field]
        vehicles.append(entry)
    return {_VEHICLE_FILE[version]: {_VEHICLE_KEY[version]: vehicles}}


def serialize_gbfs(
    shape: str,
    rows: list[dict[str, Any]],
    column_map: dict[str, str],
    system_info: dict[str, str],
    version: str,
    slug: str,
    origin: str,
    feed_timestamp: int,
) -> dict[str, Any]:
    """One shape's GBFS file set, or a SerializationError naming why not."""
    if shape not in SHAPES:
        raise SerializationError(f"shape {shape!r} is not one this serializer writes")
    if version not in SUPPORTED_VERSIONS:
        raise SerializationError(f"version {version!r} is not one this serializer writes")
    missing = sorted(REQUIRED_FIELDS[shape] - set(column_map))
    if missing:
        raise SerializationError(f"column_map is missing required field(s): {', '.join(missing)}")
    unknown = sorted(set(column_map) - SUPPORTED_FIELDS[shape])
    if unknown:
        raise SerializationError(f"column_map names field(s) this serializer does not write: {', '.join(unknown)}")
    problems = check_system_info(version, system_info)
    if problems:
        raise SerializationError("; ".join(problems))
    # -1 because this one is the feed's own clock, not a row's value.
    _check_posix(feed_timestamp, "feed_timestamp", -1)

    language = system_info["language"]
    values = _row_values(shape, rows, column_map)
    data = _station_files(values, language, version) if shape == "stations" else _vehicle_files(values, version)

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

    def wrap(payload: dict[str, Any]) -> dict[str, Any]:
        return {"last_updated": stamp, "ttl": 0, "version": version, "data": payload}

    feeds = [
        {"name": name.removesuffix(".json"), "url": f"{origin}/api/public/feeds/{slug}/{name}"}
        for name in member_files(shape, version)
    ]
    discovery: dict[str, Any] = {"feeds": feeds} if version == "3.0" else {language: {"feeds": feeds}}

    files: dict[str, Any] = {"gbfs.json": wrap(discovery), _SYSTEM_FILE: wrap(system)}
    for name, payload in data.items():
        files[name] = wrap(payload)
    return files


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
    return serialize_gbfs("stations", rows, column_map, system_info, version, slug, origin, feed_timestamp)
