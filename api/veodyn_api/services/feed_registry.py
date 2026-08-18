"""The GTFS-Realtime entity vocabulary: what a binding's `entity` field may name.

Same shape as the five seams in `registry.py`, a mutable module-level set an
import fills in. Its own module because the read side is
`schemas/published_feed.py` validating a request body. Community seeds
`vehicle_positions` below; a pack widens the set with `register_entity`, and
`extras.load_extra_modules` is what makes the pack's import happen.

**Visibility is not here.** This answers what feed content a binding may name, not
who may read one. See
`docs/superpowers/specs/2026-08-14-feeds-ce-ee-split-design.md` section 4.

Not a dynamic `Literal`: `api/openapi.json` is committed and CI diffs it, so the
wire contract cannot vary by which pack is installed. A plain `str` validated
against this registry keeps one contract and turns the variation into a refusal
naming what the deployment supports.
"""

from collections.abc import Iterator
from contextlib import contextmanager

_ENTITIES: set[str] = set()


def register_entity(entity: str) -> None:
    """Widen the vocabulary. Idempotent, so a pack agreeing with a built-in name,
    or imported twice, leaves the set unchanged rather than raising."""
    _ENTITIES.add(entity)


def entities() -> frozenset[str]:
    """Every entity this deployment accepts in a binding's `entity` field."""
    return frozenset(_ENTITIES)


def is_registered(entity: str) -> bool:
    return entity in _ENTITIES


# Community's own seed, at import, the same trigger `extras.py` documents.
register_entity("vehicle_positions")


@contextmanager
def restored_entities() -> Iterator[None]:
    """Put the vocabulary back exactly as it was when the block ends.

    For a test registering an extra entity: one test process runs every test, so a
    registration left standing leaks into whichever test collects next. See
    `registry.py`'s `restored_registries`.
    """
    saved = set(_ENTITIES)
    try:
        yield
    finally:
        _ENTITIES.clear()
        _ENTITIES.update(saved)
