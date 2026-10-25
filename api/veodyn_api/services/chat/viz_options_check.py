import json
from typing import Any

MAX_OPTIONS_CHARS = 20_000


def options_problem(value: Any, field: str) -> str | None:
    if not isinstance(value, dict):
        return f"{field} must be an object"
    if len(json.dumps(value)) > MAX_OPTIONS_CHARS:
        return f"{field} is over {MAX_OPTIONS_CHARS} characters"
    return None
