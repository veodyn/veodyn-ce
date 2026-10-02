import logging
from dataclasses import dataclass
from typing import Any

from veodyn_api.services.ai_viz_choice import (
    _ALIASES,
    CHOICE_IDS,
    CHOICE_TYPE,
    DEFAULT_CHOICE_ID,
    DEFAULT_GUIDES,
    normalized,
    rules_for,
)

logger = logging.getLogger(__name__)

MAX_ENTRIES = 60


@dataclass(frozen=True)
class VizShape:
    id: str
    viz_type: str
    label: str
    guide: str = ""


@dataclass(frozen=True)
class VizCatalog:
    shapes: tuple[VizShape, ...]

    @property
    def ids(self) -> tuple[str, ...]:
        return tuple(shape.id for shape in self.shapes)

    @property
    def fallback_id(self) -> str:
        if any(shape.id == DEFAULT_CHOICE_ID for shape in self.shapes):
            return DEFAULT_CHOICE_ID
        return self.shapes[0].id if self.shapes else DEFAULT_CHOICE_ID

    def viz_choice(self, value: object) -> str:
        picked = normalized(str(value or ""))[:64]
        offered = set(self.ids)
        if picked in offered:
            return picked
        aliased = _ALIASES.get(picked)
        if aliased is not None and aliased in offered:
            return aliased
        if picked:
            logger.warning("vizChoiceId %r is not a shape this instance offers; showing a table instead", picked)
        return self.fallback_id

    def type_for(self, choice_id: str) -> str:
        for shape in self.shapes:
            if shape.id == choice_id:
                return shape.viz_type
        return CHOICE_TYPE.get(choice_id, "TABLE")

    def choice_id_for(self, viz_type: str, options: dict[str, Any] | None = None) -> str:
        wanted = (viz_type or "").strip().upper()
        candidates = [shape for shape in self.shapes if shape.viz_type.upper() == wanted]
        if not candidates:
            return self.fallback_id
        if len(candidates) == 1:
            return candidates[0].id
        series = str((options or {}).get("globalSeriesType") or "").strip()
        picked = self.viz_choice(series) if series else ""
        if picked in {shape.id for shape in candidates}:
            return picked
        return candidates[0].id

    @property
    def rules(self) -> str:
        ordered = sorted(self.shapes, key=lambda shape: shape.id == DEFAULT_CHOICE_ID)
        return rules_for([(shape.id, shape.guide or shape.label) for shape in ordered])

    @property
    def field_description(self) -> str:
        return f"How to show the result. One of: {', '.join(self.ids)}. See the shape guide."


_DEFAULT_ORDER = (*DEFAULT_GUIDES, *(one for one in CHOICE_IDS if one not in DEFAULT_GUIDES))

DEFAULT_CATALOG = VizCatalog(
    shapes=tuple(
        VizShape(id=one, viz_type=CHOICE_TYPE[one], label=one, guide=DEFAULT_GUIDES.get(one, ""))
        for one in _DEFAULT_ORDER
    )
)


def catalog_from(raw: object) -> VizCatalog:
    if not isinstance(raw, list) or not raw:
        return DEFAULT_CATALOG
    shapes: list[VizShape] = []
    seen: set[str] = set()
    for entry in raw[:MAX_ENTRIES]:
        if not isinstance(entry, dict):
            continue
        choice_id = normalized(str(entry.get("id") or ""))[:64]
        viz_type = str(entry.get("type") or "").strip()[:64]
        if not choice_id or not viz_type or choice_id in seen:
            continue
        seen.add(choice_id)
        label = str(entry.get("label") or choice_id).strip()[:80]
        guide = " ".join(str(entry.get("guide") or "").split())[:400]
        shapes.append(VizShape(id=choice_id, viz_type=viz_type, label=label, guide=guide))
    if not shapes:
        logger.warning("a chat turn carried a vizCatalog with no usable entries; using the built-in shapes")
        return DEFAULT_CATALOG
    return VizCatalog(shapes=tuple(shapes))
