from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

AGENCY = "agency"
ROUTE = "route"
STOP = "stop"
TRIP = "trip"

KINDS: tuple[str, ...] = (AGENCY, ROUTE, STOP, TRIP)

MAX_ENTITIES_PER_KIND = 100_000
MAX_LABEL_CHARS = 200
MAX_ID_CHARS = 255

DEFAULT_LIMIT = 20
MIN_LIMIT = 1
MAX_LIMIT = 50


@dataclass(frozen=True, slots=True)
class Entity:
    kind: str
    id: str
    label: str


@dataclass(frozen=True, slots=True)
class EntityIndex:
    feed_version: str
    by_kind: Mapping[str, tuple[Entity, ...]]

    def of_kind(self, kind: str) -> tuple[Entity, ...]:
        return self.by_kind.get(kind, ())


def clamp_limit(raw: str | None) -> int:
    if raw is None or not raw.strip():
        return DEFAULT_LIMIT
    try:
        requested = int(raw.strip())
    except ValueError:
        return DEFAULT_LIMIT
    return max(MIN_LIMIT, min(MAX_LIMIT, requested))


def search(entities: Sequence[Entity], *, q: str, limit: int) -> list[Entity]:
    term = q.strip().lower()
    if not term:
        return list(entities[:limit])

    starts_with_term: list[Entity] = []
    merely_contains_term: list[Entity] = []
    for entity in entities:
        identifier = entity.id.lower()
        label = entity.label.lower()
        if identifier.startswith(term) or label.startswith(term):
            starts_with_term.append(entity)
            if len(starts_with_term) >= limit:
                break
        elif term in identifier or term in label:
            merely_contains_term.append(entity)
    return (starts_with_term + merely_contains_term)[:limit]
