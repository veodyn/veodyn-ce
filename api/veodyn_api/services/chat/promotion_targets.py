MAX_TARGET_NAME_CHARS = 64

_TARGETS: set[str] = set()


def register_promotion_target(name: str) -> None:
    if not name.strip() or len(name) > MAX_TARGET_NAME_CHARS:
        raise ValueError(f"a promotion target is named with 1 to {MAX_TARGET_NAME_CHARS} characters")
    _TARGETS.add(name)


def is_promotion_target(name: str) -> bool:
    return name in _TARGETS


def promotion_target_names() -> tuple[str, ...]:
    return tuple(sorted(_TARGETS))


for _name in ("query", "dashboard", "snippet"):
    register_promotion_target(_name)
