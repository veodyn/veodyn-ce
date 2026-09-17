"""Query rows to GTFS-Realtime bytes.

Pure: no database, no HTTP, no clock. `feed_timestamp` is passed in because the
caller owns the clock, which keeps the validator's freshness rules testable.

**Nothing is dropped.** A short feed validates clean, so every refusal below names
the row and the field. The same holds for values: protobuf will encode `nan`,
`inf` and a latitude of 91 into bytes that parse but are false, so a value that
cannot honestly become its field is refused here, where the row index is known.

Genuine absence stays absent: an optional field that is unmapped, or mapped onto
NULL or blank, says nothing rather than saying a default.
"""

from typing import Any

from google.transit import gtfs_realtime_pb2

from veodyn_api.services.gtfs_rt_values import (
    SerializationError as SerializationError,
)
from veodyn_api.services.gtfs_rt_values import (
    is_blank,
    optional_epoch_seconds,
    optional_number,
    optional_text,
    require_coordinate,
    whole_epoch_seconds,
)

# The versions this serializer can write. `schemas/published_feed.py` refuses
# anything else, and `published_feed_registry.VERSIONS_BY_STANDARD` must agree.
SUPPORTED_VERSIONS: tuple[str, ...] = ("2.0",)

REQUIRED_FIELDS: dict[str, frozenset[str]] = {
    "vehicle_positions": frozenset({"vehicle_id", "latitude", "longitude"}),
}

# Every key this serializer knows how to write. A key outside this set is refused
# rather than skipped, which would publish a quietly incomplete feed.
SUPPORTED_FIELDS: dict[str, frozenset[str]] = {
    "vehicle_positions": frozenset(
        {"vehicle_id", "latitude", "longitude", "bearing", "speed", "trip_id", "route_id", "timestamp"}
    ),
}

# Written only when a value is present: an unset protobuf float reads as 0.0,
# which is a real bearing and a real speed.
_OPTIONAL_POSITION_FLOATS = ("bearing", "speed")


def serialize_vehicle_positions(
    rows: list[dict[str, Any]],
    column_map: dict[str, str],
    feed_timestamp: int,
) -> bytes:
    """One VehiclePositions FeedMessage, or a SerializationError naming why not."""
    missing = sorted(REQUIRED_FIELDS["vehicle_positions"] - set(column_map))
    if missing:
        raise SerializationError(f"column_map is missing required field(s): {', '.join(missing)}")
    unknown = sorted(set(column_map) - SUPPORTED_FIELDS["vehicle_positions"])
    if unknown:
        raise SerializationError(
            f"column_map has field(s) this serializer does not write: {', '.join(unknown)}. "
            "Mapping a column it ignores publishes a feed that is quietly incomplete."
        )

    message = _full_dataset(feed_timestamp)

    seen: set[str] = set()
    for index, row in enumerate(rows):
        raw_id = row.get(column_map["vehicle_id"])
        if is_blank(raw_id):
            raise SerializationError(f"row {index}: vehicle_id is empty, and it is required")
        vehicle_id = str(raw_id)
        if vehicle_id in seen:
            raise SerializationError(f"duplicate vehicle_id {vehicle_id!r}: entity ids must be unique in a feed")
        seen.add(vehicle_id)

        hint = f"row {index} (vehicle_id {vehicle_id})"
        latitude = require_coordinate(row.get(column_map["latitude"]), "latitude", hint)
        longitude = require_coordinate(row.get(column_map["longitude"]), "longitude", hint)

        entity = message.entity.add()
        entity.id = vehicle_id
        vehicle = entity.vehicle
        vehicle.vehicle.id = vehicle_id
        vehicle.position.latitude = latitude
        vehicle.position.longitude = longitude

        for field in _OPTIONAL_POSITION_FLOATS:
            value = optional_number(row, column_map, field, hint)
            if value is not None:
                setattr(vehicle.position, field, value)

        # `trip` is a submessage, so touching it at all creates it: both fields are
        # read before it is reached for, or an unmapped trip publishes an empty
        # TripDescriptor a reader takes as a claim.
        trip_id = optional_text(row, column_map, "trip_id")
        route_id = optional_text(row, column_map, "route_id")
        if trip_id is not None:
            vehicle.trip.trip_id = trip_id
        if route_id is not None:
            vehicle.trip.route_id = route_id

        stamp = optional_epoch_seconds(row, column_map, hint)
        if stamp is not None:
            vehicle.timestamp = stamp

    return _deterministic_bytes_of(message)


ALERT_KEYS: dict[str, frozenset[str]] = {
    "required": frozenset({"entity_id", "severity", "cause", "effect", "informed_entities", "header", "description"}),
    "optional": frozenset({"active_periods", "url"}),
}

SUPPORTED_ALERT_KEYS: frozenset[str] = ALERT_KEYS["required"] | ALERT_KEYS["optional"]

_ALERT_ENUMS: dict[str, tuple[str, Any]] = {
    "severity": ("severity_level", gtfs_realtime_pb2.Alert.SeverityLevel),
    "cause": ("cause", gtfs_realtime_pb2.Alert.Cause),
    "effect": ("effect", gtfs_realtime_pb2.Alert.Effect),
}

_PLAIN_ID_SELECTOR_FIELD_BY_KIND: dict[str, str] = {"agency": "agency_id", "route": "route_id", "stop": "stop_id"}

_SUBMESSAGE_SELECTOR_KIND = "trip"

SUPPORTED_ENTITY_KINDS: frozenset[str] = frozenset({*_PLAIN_ID_SELECTOR_FIELD_BY_KIND, _SUBMESSAGE_SELECTOR_KIND})

_REQUIRED_TRANSLATED_TEXT_FIELDS: tuple[tuple[str, str], ...] = (
    ("header", "header_text"),
    ("description", "description_text"),
)

_OPTIONAL_TRANSLATED_TEXT_FIELDS: tuple[tuple[str, str], ...] = (("url", "url"),)


def alert_enum_values(field: str) -> frozenset[str]:
    return frozenset(_ALERT_ENUMS[field][1].keys())


def _full_dataset(feed_timestamp: int) -> Any:
    message = gtfs_realtime_pb2.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    message.header.incrementality = gtfs_realtime_pb2.FeedHeader.FULL_DATASET
    message.header.timestamp = feed_timestamp
    return message


def _deterministic_bytes_of(message: Any) -> bytes:
    payload: bytes = message.SerializeToString(deterministic=True)
    return payload


def _enum_value(field: str, raw: Any, hint: str) -> int:
    if is_blank(raw):
        raise SerializationError(f"{hint}: {field} is empty, and it is required")
    name = str(raw)
    accepted = alert_enum_values(field)
    if name not in accepted:
        raise SerializationError(
            f"{hint}: {field} value {name!r} is not a GTFS-Realtime {field}. Known: {', '.join(sorted(accepted))}"
        )
    value: int = _ALERT_ENUMS[field][1].Value(name)
    return value


def _translations(raw: Any, field: str, hint: str) -> list[tuple[str, str]]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise SerializationError(f"{hint}: {field} is a {type(raw).__name__}, not a list of translations")
    written: list[tuple[str, str]] = []
    for value in raw:
        if not isinstance(value, dict):
            raise SerializationError(f"{hint}: {field} holds a {type(value).__name__}, not a translation")
        language = value.get("language")
        text = value.get("text")
        if is_blank(language):
            raise SerializationError(f"{hint}: a {field} translation names no language")
        if is_blank(text):
            raise SerializationError(f"{hint}: the {field} translation for {str(language)!r} carries no text")
        written.append((str(language), str(text)))
    return written


def _write_translations(target: Any, translations: list[tuple[str, str]]) -> None:
    for language, text in translations:
        entry = target.translation.add()
        entry.text = text
        entry.language = language


def _write_informed_entities(alert: Any, raw: Any, hint: str) -> None:
    if not isinstance(raw, list) or not raw:
        raise SerializationError(f"{hint}: informed_entities is empty, and an alert must name what it affects")
    for value in raw:
        if not isinstance(value, dict):
            raise SerializationError(f"{hint}: informed_entities holds a {type(value).__name__}, not an entity")
        kind = value.get("kind")
        entity_id = value.get("id")
        if kind not in SUPPORTED_ENTITY_KINDS:
            raise SerializationError(
                f"{hint}: informed entity kind {kind!r} is not one this serializer selects on. "
                f"Known: {', '.join(sorted(SUPPORTED_ENTITY_KINDS))}"
            )
        if is_blank(entity_id):
            raise SerializationError(f"{hint}: an informed {kind} entity carries no id")
        selector = alert.informed_entity.add()
        if kind == _SUBMESSAGE_SELECTOR_KIND:
            selector.trip.trip_id = str(entity_id)
        else:
            setattr(selector, _PLAIN_ID_SELECTOR_FIELD_BY_KIND[str(kind)], str(entity_id))


def _write_active_periods(alert: Any, raw: Any, hint: str) -> None:
    if raw is None:
        return
    if not isinstance(raw, list):
        raise SerializationError(f"{hint}: active_periods is a {type(raw).__name__}, not a list of periods")
    for index, value in enumerate(raw):
        if not isinstance(value, dict):
            raise SerializationError(f"{hint}: active period {index} is a {type(value).__name__}, not a period")
        unknown = sorted(set(value) - {"start", "end"})
        if unknown:
            raise SerializationError(f"{hint}: active period {index} carries unknown key(s): {', '.join(unknown)}")
        bounds: dict[str, int] = {}
        for bound in ("start", "end"):
            if is_blank(value.get(bound)):
                continue
            bounds[bound] = whole_epoch_seconds(value[bound], f"active period {index} {bound}", hint)
        if not bounds:
            raise SerializationError(
                f"{hint}: active period {index} names neither a start nor an end, so it covers all of time "
                "rather than a window"
            )
        if "start" in bounds and "end" in bounds and bounds["end"] < bounds["start"]:
            raise SerializationError(
                f"{hint}: active period {index} ends at {bounds['end']}, before it starts at {bounds['start']}"
            )
        period = alert.active_period.add()
        for bound, when in bounds.items():
            setattr(period, bound, when)


def serialize_service_alerts(rows: list[dict[str, Any]], feed_timestamp: int) -> bytes:
    message = _full_dataset(feed_timestamp)

    seen: set[str] = set()
    for index, row in enumerate(rows):
        unknown = sorted(set(row) - SUPPORTED_ALERT_KEYS)
        if unknown:
            raise SerializationError(
                f"row {index}: key(s) this serializer does not write: {', '.join(unknown)}. "
                "Carrying a key it ignores publishes a feed that is quietly incomplete."
            )
        raw_id = row.get("entity_id")
        if is_blank(raw_id):
            raise SerializationError(f"row {index}: entity_id is empty, and it is required")
        entity_id = str(raw_id)
        if entity_id in seen:
            raise SerializationError(f"duplicate entity_id {entity_id!r}: entity ids must be unique in a feed")
        seen.add(entity_id)

        hint = f"row {index} (entity_id {entity_id})"
        required_text: list[tuple[str, list[tuple[str, str]]]] = []
        for field, attribute in _REQUIRED_TRANSLATED_TEXT_FIELDS:
            written = _translations(row.get(field), field, hint)
            if not written:
                raise SerializationError(f"{hint}: {field} is empty, and it is required")
            required_text.append((attribute, written))

        entity = message.entity.add()
        entity.id = entity_id
        alert = entity.alert
        for field, (attribute, _) in _ALERT_ENUMS.items():
            setattr(alert, attribute, _enum_value(field, row.get(field), hint))
        _write_informed_entities(alert, row.get("informed_entities"), hint)
        _write_active_periods(alert, row.get("active_periods"), hint)
        for attribute, written in required_text:
            _write_translations(getattr(alert, attribute), written)
        for field, attribute in _OPTIONAL_TRANSLATED_TEXT_FIELDS:
            _write_translations(getattr(alert, attribute), _translations(row.get(field), field, hint))

    return _deterministic_bytes_of(message)
