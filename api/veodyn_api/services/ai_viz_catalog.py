"""The shapes ONE instance can draw, as its app reported them.

ai_viz_choice.py holds a closed list of fourteen ids, hand-copied from
`app/src/lib/viz-choices.ts` under a comment admitting the copy: "this service
cannot import TypeScript: if that file gains a choice, add it here too."

For core types that is a maintenance smell. For a PACK visualization it is a
wall. The API image does not install a pack at all — PACK_MANIFEST.json wires a
Python half into the Redash worker and a frontend half into the Next build, and
this sidecar is neither — so no hand-copy here could know a tenant's types
exist. The model would ask for one, `viz_choice` would fail to match it, and it
would clamp to "table" behind a log line nobody reads. That is the whole reason
a destination board came back as a grid of latitudes.

So the app sends its catalog with each chat turn and this module renders the
model's instructions from it. The app is the only party that can: the registry
is what the bundle really contains, and `visualizations.enabled` is per-instance
config this service never sees.

A turn that arrives WITHOUT a catalog keeps today's behaviour exactly, via
DEFAULT_CATALOG. That covers an older app against a newer sidecar, and the
converse and outline paths, which have no turn to carry one.
"""

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

# A ceiling on what one turn may declare. The catalog is built server side by
# our own route handler, so this guards a bug rather than an attacker: a
# runaway registry should cost a rejected turn, not a prompt the size of the
# transcript budget.
MAX_ENTRIES = 60


@dataclass(frozen=True)
class VizShape:
    """One shape on offer: an id the model may name, and what it produces."""

    id: str
    viz_type: str
    label: str
    guide: str = ""


@dataclass(frozen=True)
class VizCatalog:
    """Every shape one instance offers, and the prose that explains them.

    The same four questions ai_viz_choice.py answers for the built-in list,
    asked of whatever this image actually registered.
    """

    shapes: tuple[VizShape, ...]

    @property
    def ids(self) -> tuple[str, ...]:
        return tuple(shape.id for shape in self.shapes)

    @property
    def fallback_id(self) -> str:
        """What an unrecognized id becomes.

        The table when it is on offer. An instance that has hidden the table is
        strange but legal, and clamping to an id this catalog does not contain
        would hand the frontend a shape it cannot resolve, so the first shape
        stands in.
        """
        if any(shape.id == DEFAULT_CHOICE_ID for shape in self.shapes):
            return DEFAULT_CHOICE_ID
        return self.shapes[0].id if self.shapes else DEFAULT_CHOICE_ID

    def viz_choice(self, value: object) -> str:
        """One of `ids`: what the model said, or the fallback.

        Aliases are consulted only when they land on a shape this catalog has.
        `_ALIASES` maps "bar" to "chart-bar", which is worse than useless on an
        instance where the chart is switched off: it would resolve to a shape
        the frontend then refuses, where clamping to the table draws something.
        """
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
        """The Redash type a shape produces, or the table for one we do not know."""
        for shape in self.shapes:
            if shape.id == choice_id:
                return shape.viz_type
        return CHOICE_TYPE.get(choice_id, "TABLE")

    def choice_id_for(self, viz_type: str, options: dict[str, Any] | None = None) -> str:
        """The shape id a STORED visualization amounts to.

        The inverse of `type_for`, and not injective: a type may back several
        ids. CHART is the case that exists — five shapes told apart by
        `globalSeriesType` — but the rule is written over the catalog rather
        than over CHART by name, so a pack type that later declares two choices
        is not silently resolved to whichever came first.

        The series name goes through `viz_choice` rather than being matched
        directly, because Redash writes `column` for what this build calls a bar
        and the alias table already knows that.
        """
        wanted = (viz_type or "").strip().upper()
        candidates = [shape for shape in self.shapes if shape.viz_type.upper() == wanted]
        if not candidates:
            return self.fallback_id
        if len(candidates) == 1:
            return candidates[0].id
        series = str((options or {}).get("globalSeriesType") or "").strip()
        picked = self.viz_choice(series) if series else ""
        # A widget whose distinguishing option is missing or unrecognized is
        # still one of these shapes. Falling through to the table would tell the
        # model a chart is a table and invite it to "fix" one that is fine.
        if picked in {shape.id for shape in candidates}:
            return picked
        return candidates[0].id

    @property
    def rules(self) -> str:
        """The shape guide, over these shapes.

        A shape with no guide is still listed, under its label, so a plugin that
        declares a choice and forgets the sentence is offered rather than
        hidden. `table` is pushed last whatever order it arrived in: the tail
        prose calls it "the LAST resort, for a result no shape above fits", and
        the frontend's registration order puts it first.
        """
        ordered = sorted(self.shapes, key=lambda shape: shape.id == DEFAULT_CHOICE_ID)
        return rules_for([(shape.id, shape.guide or shape.label) for shape in ordered])

    @property
    def field_description(self) -> str:
        return f"How to show the result. One of: {', '.join(self.ids)}. See the shape guide."


# In DEFAULT_GUIDES' order, so that `DEFAULT_CATALOG.rules` reproduces VIZ_RULES
# exactly and the no-catalog path is unchanged prose for unchanged prose.
# CHOICE_IDS is registration order, which starts with the table; the guide is an
# argument that runs from the most specific shape to the last resort. A shape in
# CHOICE_IDS with no guide written for it is appended rather than dropped.
_DEFAULT_ORDER = (*DEFAULT_GUIDES, *(one for one in CHOICE_IDS if one not in DEFAULT_GUIDES))

DEFAULT_CATALOG = VizCatalog(
    shapes=tuple(
        VizShape(id=one, viz_type=CHOICE_TYPE[one], label=one, guide=DEFAULT_GUIDES.get(one, ""))
        for one in _DEFAULT_ORDER
    )
)


def catalog_from(raw: object) -> VizCatalog:
    """The catalog a chat turn carried, or the built-in one.

    Defensive about every field despite the payload being built by our own route
    handler: it crosses a process boundary, and the cost of a malformed entry
    should be that one shape going unoffered, not a turn that cannot start.

    An entry naming a type this service has never heard of is kept. That is the
    point of the exercise — `RIITS_DESTINATION_BOARD` is exactly such a type,
    and the API does not need to know what it draws to let the model name it.
    """
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
