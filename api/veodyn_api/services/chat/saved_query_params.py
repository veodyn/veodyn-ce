import json
from typing import Any

MAX_PARAMS = 20
MAX_PARAMS_CHARS = 4_000
MAX_LIST_ITEMS = 50
MAX_PARAM_NAME_CHARS = 64
MAX_VALUE_CHARS = 500
MAX_RANGE_END_CHARS = 64


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _short_text(value: Any, limit: int) -> bool:
    return isinstance(value, str) and len(value) <= limit


def _is_range(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"start", "end"}
        and _short_text(value["start"], MAX_RANGE_END_CHARS)
        and _short_text(value["end"], MAX_RANGE_END_CHARS)
    )


def _valid_value(value: Any) -> bool:
    if _short_text(value, MAX_VALUE_CHARS) or _is_number(value):
        return True
    if isinstance(value, list):
        return len(value) <= MAX_LIST_ITEMS and all(_short_text(one, MAX_VALUE_CHARS) for one in value)
    return _is_range(value)


def params_problem(raw: Any) -> str | None:
    if not isinstance(raw, dict):
        return "params must be an object of parameter name to value"
    if len(raw) > MAX_PARAMS:
        return f"params names more than {MAX_PARAMS} parameters"
    for name, value in raw.items():
        if not name or len(name) > MAX_PARAM_NAME_CHARS:
            return f"a parameter name must be 1 to {MAX_PARAM_NAME_CHARS} characters"
        if not _valid_value(value):
            return (
                f"parameter {name!r} must be a string, a number, a list of at most {MAX_LIST_ITEMS} strings, or "
                "an object with string start and end"
            )
    if len(json.dumps(raw, separators=(",", ":"))) > MAX_PARAMS_CHARS:
        return f"params are too large (over {MAX_PARAMS_CHARS} characters); keep values short"
    return None
