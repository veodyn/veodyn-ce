"""The closed vocabularies GBFS defines, read out of the schemas that judge a
publish rather than restated here.

`system_information.timezone` is an `enum` in the GBFS schema, so a person
typing it is guessing at a list the validator already holds. The list comes from
the pinned gbfs-validator distribution, the same copy `gbfs_validation.py` runs a
serialized file set through, so a picker built from this cannot offer a value
that publish would then refuse.

`language` is deliberately absent: the schema constrains it with a pattern
(`^[a-z]{2,3}(-[A-Z]{2})?$`), not an enum, so there is no closed list to serve.
"""

import json
from functools import lru_cache
from importlib.resources import files
from typing import Any

from veodyn_api.services import published_feed_registry


def timezones_for(standard: str) -> tuple[str, ...]:
    """The timezone names a binding under `standard` may declare, empty for a
    standard whose declaration carries no timezone."""
    return _gbfs_timezones() if standard == "gbfs" else ()


@lru_cache(maxsize=1)
def _gbfs_timezones() -> tuple[str, ...]:
    """The names every GBFS version this build publishes accepts.

    Intersected rather than read from one version: a version that narrowed the
    enum would otherwise have this offering values it refuses. Empty when a
    schema cannot be read, which degrades the form to a text field instead of
    failing the whole capabilities read over a picker.
    """
    accepted: set[str] | None = None
    for version in published_feed_registry.VERSIONS_BY_STANDARD.get("gbfs", ()):
        declared = _timezone_enum(version)
        if declared is None:
            return ()
        accepted = declared if accepted is None else accepted & declared
    return tuple(sorted(accepted or ()))


def _timezone_enum(version: str) -> set[str] | None:
    path = files("gbfs_validator") / "data" / "schemas" / f"v{version}" / "system_information.json"
    try:
        schema: Any = json.loads(path.read_text(encoding="utf-8"))
        declared = schema["properties"]["data"]["properties"]["timezone"]["enum"]
    except (OSError, KeyError, TypeError, ValueError):
        return None
    return {str(name) for name in declared}
