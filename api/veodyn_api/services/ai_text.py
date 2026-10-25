from typing import Any, TypeVar

_Choice = TypeVar("_Choice", bound=str)


def text_of(value: Any, limit: int = 500) -> str:
    return str(value or "").strip()[:limit]


def picked_id(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def one_of(value: Any, allowed: tuple[_Choice, ...], fallback: _Choice) -> _Choice:
    picked = text_of(value, 64)
    return next((one for one in allowed if one == picked), fallback)
