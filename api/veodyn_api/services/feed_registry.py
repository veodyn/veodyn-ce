"""The GTFS-Realtime entity vocabulary: what a binding's `entity` field may name.

Same shape as the five seams in `registry.py` -- a mutable module-level set
that an import fills in, so a build with no packs installed sees exactly what
community seeded and nothing more. It is its own module rather than a sixth
entry in `registry.py`, because the read side is consumed by
`schemas/published_feed.py` to validate a request body, which is a different
caller from the routers, jobs and object types that file's seams serve.

Community seeds `vehicle_positions` at import, below. An enterprise pack widens
the set by calling `register_entity` for `trip_updates` and `service_alerts`
from its own registration module, the same way `veodyn_enterprise.registration`
adds routers and jobs through `registry.py` today: importing the pack's module
is what runs the registration, and `extras.load_extra_modules` is what makes
that import happen on a deployment that names the pack.

**Visibility is not here, and is not going to be.** This registry answers "what
kind of feed content can a binding name", not "who may read one". See
`docs/superpowers/specs/2026-08-14-feeds-ce-ee-split-design.md` section 4:
folding visibility into a registered-values list was revision 1's mistake, and
the reason is the default -- `visibility` defaults to `private`, so a registry
that only accepted `public` would make the default itself unwritable.

Why a dynamic `Literal` was never the answer: `api/openapi.json` is committed
and CI diffs it against what the service generates, so the wire contract
cannot vary by which pack happens to be installed. Validating a plain `str`
against this registry keeps one contract for every deployment and turns the
variation into a refusal message instead, which is also the more useful error:
naming what a deployment supports beats a 422 about an enum nobody can see.
"""

from collections.abc import Iterator
from contextlib import contextmanager

_ENTITIES: set[str] = set()


def register_entity(entity: str) -> None:
    """Widen the vocabulary. Idempotent, so a built-in and a pack agreeing on a
    name, or the same pack module imported twice, leaves the set unchanged
    rather than raising."""
    _ENTITIES.add(entity)


def entities() -> frozenset[str]:
    """Every entity this deployment accepts in a binding's `entity` field."""
    return frozenset(_ENTITIES)


def is_registered(entity: str) -> bool:
    return entity in _ENTITIES


# Community's own seed. Runs at import, the same trigger `extras.py` documents
# for a pack: importing this module is what registers what it knows.
register_entity("vehicle_positions")


@contextmanager
def restored_entities() -> Iterator[None]:
    """Put the vocabulary back exactly as it was when the block ends.

    For a test that registers an extra entity to prove the pack seam widens
    what the schema accepts. Registration has no `unregister` and none is
    needed in production -- an import happens once per process -- but a test
    process runs every test in one process, so a registration left standing
    would leak into whichever test collects next. See `registry.py`'s own
    `restored_registries` for the fuller version of this reasoning.
    """
    saved = set(_ENTITIES)
    try:
        yield
    finally:
        _ENTITIES.clear()
        _ENTITIES.update(saved)
