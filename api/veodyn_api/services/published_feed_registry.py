"""The feed entity vocabulary per standard: what a binding's `entity` field may
name, given the `standard` it names alongside.

Same shape as the five seams in `registry.py`, a mutable module-level mapping an
import fills in. Its own module because the read side is
`schemas/published_feed.py` validating a request body. Community seeds
`vehicle_positions` under `gtfs-rt` and `stations` under `gbfs` below; a pack
widens one standard's set with `register_entity`, and `extras.load_extra_modules`
is what makes the pack's import happen.

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

_ENTITIES: dict[str, set[str]] = {}

# The version vocabulary per standard. The serializers are the implementations;
# this is the single declaration that capabilities and the wire validator read.
VERSIONS_BY_STANDARD: dict[str, tuple[str, ...]] = {
    "gtfs-rt": ("2.0",),
    "gbfs": ("2.3", "3.0"),
}


def register_entity(entity: str, standard: str = "gtfs-rt") -> None:
    """Widen one standard's vocabulary. Idempotent, so a pack agreeing with a
    built-in name, or imported twice, leaves the set unchanged rather than
    raising.

    The default is a contract, not a convenience: the enterprise pack lives in
    another repository and calls this with one argument.
    """
    _ENTITIES.setdefault(standard, set()).add(entity)


def entities(standard: str) -> frozenset[str]:
    """Every entity this deployment accepts in a binding's `entity` field when
    the binding names `standard`. An unregistered standard reads as empty."""
    return frozenset(_ENTITIES.get(standard, set()))


def standards() -> frozenset[str]:
    """Every standard something has registered an entity under."""
    return frozenset(_ENTITIES)


def is_registered(entity: str, standard: str) -> bool:
    return entity in _ENTITIES.get(standard, set())


# Community's own seed, at import, the same trigger `extras.py` documents.
register_entity("vehicle_positions", "gtfs-rt")
register_entity("stations", "gbfs")


@contextmanager
def restored_entities() -> Iterator[None]:
    """Put the vocabulary back exactly as it was when the block ends.

    For a test registering an extra entity: one test process runs every test, so a
    registration left standing leaks into whichever test collects next. See
    `registry.py`'s `restored_registries`.

    Each set is copied, not just the dict: a shallow copy shares the sets, so the
    restore would keep the very registration it is there to drop.
    """
    saved = {standard: set(names) for standard, names in _ENTITIES.items()}
    try:
        yield
    finally:
        _ENTITIES.clear()
        _ENTITIES.update(saved)
