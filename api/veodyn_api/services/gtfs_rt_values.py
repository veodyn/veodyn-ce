import math
from typing import Any

COORDINATE_LIMITS: dict[str, float] = {"latitude": 90.0, "longitude": 180.0}

MAX_FLOAT32 = 3.4028234663852886e38

MAX_UINT64 = 2**64 - 1


class SerializationError(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def is_blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def coerce_number(value: Any, field: str, entity_hint: str) -> float:
    if isinstance(value, bool):
        raise SerializationError(f"{entity_hint}: {field} value {value!r} is a boolean, not a number")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise SerializationError(f"{entity_hint}: {field} value {value!r} is not a number") from exc
    if not math.isfinite(number):
        raise SerializationError(f"{entity_hint}: {field} value {value!r} is not a finite number")
    return number


def require_float32(number: float, value: Any, field: str, entity_hint: str) -> float:
    if abs(number) > MAX_FLOAT32:
        raise SerializationError(
            f"{entity_hint}: {field} value {value!r} is too large for the 32-bit float the field holds, "
            "and would be published as infinity"
        )
    return number


def require_coordinate(value: Any, field: str, entity_hint: str) -> float:
    if is_blank(value):
        raise SerializationError(f"{entity_hint}: {field} is empty, and it is required")
    number = coerce_number(value, field, entity_hint)
    limit = COORDINATE_LIMITS[field]
    if not -limit <= number <= limit:
        raise SerializationError(
            f"{entity_hint}: {field} value {value!r} is outside the WGS-84 range [-{limit:g}, {limit:g}]"
        )
    return require_float32(number, value, field, entity_hint)


def whole_epoch_seconds(value: Any, field: str, entity_hint: str) -> int:
    number = coerce_number(value, field, entity_hint)
    if number != int(number):
        raise SerializationError(
            f"{entity_hint}: {field} value {value!r} is not a whole number of seconds, and truncating it "
            "would move the reported time without saying so"
        )
    if not 0 <= number <= MAX_UINT64:
        raise SerializationError(
            f"{entity_hint}: {field} value {value!r} is outside the range of epoch seconds the field holds"
        )
    return int(number)


def optional_number(row: dict[str, Any], column_map: dict[str, str], field: str, entity_hint: str) -> float | None:
    column = column_map.get(field)
    if column is None:
        return None
    value = row.get(column)
    if is_blank(value):
        return None
    number = coerce_number(value, field, entity_hint)
    return require_float32(number, value, field, entity_hint)


def optional_epoch_seconds(row: dict[str, Any], column_map: dict[str, str], entity_hint: str) -> int | None:
    column = column_map.get("timestamp")
    if column is None:
        return None
    value = row.get(column)
    if is_blank(value):
        return None
    return whole_epoch_seconds(value, "timestamp", entity_hint)


def optional_text(row: dict[str, Any], column_map: dict[str, str], field: str) -> str | None:
    column = column_map.get(field)
    if column is None:
        return None
    value = row.get(column)
    if is_blank(value):
        return None
    return str(value)
