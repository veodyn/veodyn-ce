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

import math
from typing import Any

from google.transit import gtfs_realtime_pb2

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

# WGS-84, the only coordinate system GTFS-Realtime positions are in.
_COORDINATE_LIMITS: dict[str, float] = {"latitude": 90.0, "longitude": 180.0}

# `Position.latitude`, `longitude`, `bearing` and `speed` are protobuf `float`, so
# anything past this rounds to infinity on the way in.
_MAX_FLOAT32 = 3.4028234663852886e38

# `VehiclePosition.timestamp` is uint64. Outside this range protobuf raises a bare
# ValueError that loses the row index.
_MAX_UINT64 = 2**64 - 1


class SerializationError(Exception):
    """A binding or a row that cannot honestly become a feed entity."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _is_blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _coerce_number(value: Any, field: str, entity_hint: str) -> float:
    """A present value read as a finite number, or a refusal naming the row.

    Booleans are refused before `float()` sees them: `float(True)` is 1.0, a
    perfectly ordinary coordinate and never what a boolean column meant.
    """
    if isinstance(value, bool):
        raise SerializationError(f"{entity_hint}: {field} value {value!r} is a boolean, not a number")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise SerializationError(f"{entity_hint}: {field} value {value!r} is not a number") from exc
    if not math.isfinite(number):
        raise SerializationError(f"{entity_hint}: {field} value {value!r} is not a finite number")
    return number


def _require_float32(number: float, value: Any, field: str, entity_hint: str) -> float:
    if abs(number) > _MAX_FLOAT32:
        raise SerializationError(
            f"{entity_hint}: {field} value {value!r} is too large for the 32-bit float the field holds, "
            "and would be published as infinity"
        )
    return number


def _require_coordinate(value: Any, field: str, entity_hint: str) -> float:
    """A required WGS-84 coordinate, in range and finite, or a refusal."""
    if _is_blank(value):
        raise SerializationError(f"{entity_hint}: {field} is empty, and it is required")
    number = _coerce_number(value, field, entity_hint)
    limit = _COORDINATE_LIMITS[field]
    if not -limit <= number <= limit:
        raise SerializationError(
            f"{entity_hint}: {field} value {value!r} is outside the WGS-84 range [-{limit:g}, {limit:g}]"
        )
    return _require_float32(number, value, field, entity_hint)


def _optional_number(row: dict[str, Any], column_map: dict[str, str], field: str, entity_hint: str) -> float | None:
    """An optional numeric field: absent when unstated, refused when unusable.

    Unmapped, NULL or blank means the source said nothing, so the field stays
    absent. A mapped column holding `"north"` is a source defect, and is refused.
    """
    column = column_map.get(field)
    if column is None:
        return None
    value = row.get(column)
    if _is_blank(value):
        return None
    number = _coerce_number(value, field, entity_hint)
    return _require_float32(number, value, field, entity_hint)


def _optional_epoch_seconds(row: dict[str, Any], column_map: dict[str, str], entity_hint: str) -> int | None:
    """`timestamp` as whole seconds, refusing anything `int()` would reshape.

    The field cannot carry sub-second precision, so a fractional value is refused
    with its row named rather than truncated silently.
    """
    column = column_map.get("timestamp")
    if column is None:
        return None
    value = row.get(column)
    if _is_blank(value):
        return None
    number = _coerce_number(value, "timestamp", entity_hint)
    if number != int(number):
        raise SerializationError(
            f"{entity_hint}: timestamp value {value!r} is not a whole number of seconds, and truncating it "
            "would move the reported time without saying so"
        )
    if not 0 <= number <= _MAX_UINT64:
        raise SerializationError(
            f"{entity_hint}: timestamp value {value!r} is outside the range of epoch seconds the field holds"
        )
    return int(number)


def _optional_text(row: dict[str, Any], column_map: dict[str, str], field: str) -> str | None:
    column = column_map.get(field)
    if column is None:
        return None
    value = row.get(column)
    if _is_blank(value):
        return None
    return str(value)


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

    message = gtfs_realtime_pb2.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    message.header.incrementality = gtfs_realtime_pb2.FeedHeader.FULL_DATASET
    message.header.timestamp = feed_timestamp

    seen: set[str] = set()
    for index, row in enumerate(rows):
        raw_id = row.get(column_map["vehicle_id"])
        if _is_blank(raw_id):
            raise SerializationError(f"row {index}: vehicle_id is empty, and it is required")
        vehicle_id = str(raw_id)
        if vehicle_id in seen:
            raise SerializationError(f"duplicate vehicle_id {vehicle_id!r}: entity ids must be unique in a feed")
        seen.add(vehicle_id)

        hint = f"row {index} (vehicle_id {vehicle_id})"
        latitude = _require_coordinate(row.get(column_map["latitude"]), "latitude", hint)
        longitude = _require_coordinate(row.get(column_map["longitude"]), "longitude", hint)

        entity = message.entity.add()
        entity.id = vehicle_id
        vehicle = entity.vehicle
        vehicle.vehicle.id = vehicle_id
        vehicle.position.latitude = latitude
        vehicle.position.longitude = longitude

        for field in _OPTIONAL_POSITION_FLOATS:
            value = _optional_number(row, column_map, field, hint)
            if value is not None:
                setattr(vehicle.position, field, value)

        # `trip` is a submessage, so touching it at all creates it: both fields are
        # read before it is reached for, or an unmapped trip publishes an empty
        # TripDescriptor a reader takes as a claim.
        trip_id = _optional_text(row, column_map, "trip_id")
        route_id = _optional_text(row, column_map, "route_id")
        if trip_id is not None:
            vehicle.trip.trip_id = trip_id
        if route_id is not None:
            vehicle.trip.route_id = route_id

        stamp = _optional_epoch_seconds(row, column_map, hint)
        if stamp is not None:
            vehicle.timestamp = stamp

    # deterministic=True: the artifact digest and the validator's content-changed
    # rule both compare serialized output, and protobuf map ordering is otherwise
    # free to vary between runs. Annotated because `SerializeToString` is untyped.
    payload: bytes = message.SerializeToString(deterministic=True)
    return payload
