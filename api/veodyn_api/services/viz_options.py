"""What the model may say about how a result is drawn.

The option surface is not invented here. schemas/public_viz_options.py already
declares, per type, every key a renderer reads and the shape it must have, and it
is the gate a published report's options go through. So this module DERIVES the
tool schema and the written guide from that same table: one declaration produces
what the model is asked for, what it is told, and what its answer is checked
against, and the three cannot drift.

This call happens after the SQL exists, which is the whole point. The interview
picks a shape from an intent; only a statement has result columns, and a chart is
bound to column names. Asking earlier would be asking the model to guess the
aliases of a query it has not written yet.
"""

import logging
from typing import Any

from veodyn_api.schemas.public_viz_options import (
    PUBLIC_VIZ_OPTIONS,
    Arr,
    Fields,
    ObjMap,
    Rule,
    StringMap,
)
from veodyn_api.services.llm import LlmClient, compact_json
from veodyn_api.services.result_shape import ResultColumn

logger = logging.getLogger(__name__)

SYSTEM = """You choose how one query result is drawn.

The statement has been written and checked. You are given the columns it returns
and the shape the analyst was already shown, and you answer with the options that
make that shape readable.

Rules:
- Name ONLY the columns you are given. A name that is not in the list is dropped.
- Do not change the shape. The analyst has already been shown it.
- Leave out any option you have no reason to set. A default you restate is a
  default someone has to read.
- Never claim a result. Nothing has run."""

# What a key is FOR, where the name does not say it. Only the keys worth a
# sentence: a key with no note is still offered, it just goes unexplained.
OPTION_NOTES: dict[str, dict[str, str]] = {
    "CHART": {
        "columnMapping": (
            'Which column plays which part: {"<column>": "x" | "y" | "series"}. '
            "`series` splits one measure into one line per value of that column, which is what a result "
            "with a time column, a category column and one measure needs. Without it every numeric column "
            "is drawn as its own series against the first column."
        ),
        "series": '{"stacking": "stack"} to sum the series into a total, "percent" for share of total.',
        "indexed": (
            "true to draw every series as a percentage of its own first value, on one axis. This is how "
            "this product compares series of different magnitude. Do NOT reach for a second y axis."
        ),
        "yAxis": (
            '[{"type": "logarithmic"}] when the measures span orders of magnitude. rangeMin/rangeMax to pin the scale.'
        ),
        "referenceLines": '[{"value": 30, "label": "target"}] for a threshold the reader is judging against.',
        "swappedAxes": "true for a bar chart whose category labels are long enough to overlap.",
        "showDataLabels": "true only for a handful of bars or slices. On a dense series it is unreadable.",
        "donut": "pie only.",
    },
    "COUNTER": {
        "counterColName": "The column holding the number.",
        "targetColName": "The column holding what it is compared against, when there is one.",
    },
    "HEATMAP": {
        "columnMapping": '{"<column>": "x" | "y" | "value"} over two grouping columns and one measure.',
    },
    "MAP": {"latColName": "The latitude column.", "lonColName": "The longitude column."},
}

_SCALARS = {"string": "string", "number": "number", "boolean": "boolean"}


def _json_schema(rule: Rule) -> dict[str, Any]:
    if isinstance(rule, str):
        return {"type": _SCALARS[rule]}
    if isinstance(rule, StringMap):
        return {"type": "object", "additionalProperties": {"type": "string"}}
    if isinstance(rule, Arr):
        return {"type": "array", "items": _json_schema(rule.item)}
    if isinstance(rule, ObjMap):
        return {"type": "object", "additionalProperties": _object_schema(rule.fields)}
    return _object_schema(rule.fields)


def _object_schema(fields: Fields) -> dict[str, Any]:
    return {"type": "object", "properties": {key: _json_schema(rule) for key, rule in fields.items()}}


def options_tool_schema(viz_type: str) -> dict[str, Any]:
    """The forced tool's shape for one type, straight off the allowlist."""
    return _object_schema(PUBLIC_VIZ_OPTIONS.get(viz_type, {}))


def option_guide(viz_type: str) -> str:
    """The same keys as prose, so the model knows what they are for."""
    notes = OPTION_NOTES.get(viz_type, {})
    lines = [f"- `{key}`: {notes[key]}" for key in PUBLIC_VIZ_OPTIONS.get(viz_type, {}) if key in notes]
    other = [key for key in PUBLIC_VIZ_OPTIONS.get(viz_type, {}) if key not in notes]
    if other:
        lines.append(f"- also available: {', '.join(f'`{key}`' for key in other)}")
    return "\n".join(lines)


def _column_rows(columns: tuple[ResultColumn, ...]) -> list[dict[str, str]]:
    return [{"name": column.name, "type": column.type, "kind": column.kind} for column in columns]


def author_options(
    llm: LlmClient,
    *,
    viz_type: str,
    shape: str,
    intent: str,
    columns: tuple[ResultColumn, ...],
) -> dict[str, Any]:
    """The options the model asks for, or {} when it could not be asked.

    {} rather than a raise: the binder downstream produces a usable chart from
    the result shape alone, so a provider failure here costs a good chart and
    never a proposal.
    """
    schema = {
        "type": "object",
        "properties": {"options": options_tool_schema(viz_type)},
        "required": ["options"],
    }
    prompt = "\n\n".join(
        [
            f"Shape the analyst was shown: {shape}",
            f"What the query is for: {intent}",
            f"Columns the statement returns: {compact_json(_column_rows(columns))}",
            f"Options you may set:\n{option_guide(viz_type)}",
        ]
    )
    try:
        answer = llm.structured(system=SYSTEM, prompt=prompt, schema=schema, tool_name="shape_result")
    except Exception:
        logger.info("could not author options for a %s; the binder will decide alone", viz_type, exc_info=True)
        return {}
    options = answer.get("options")
    if not isinstance(options, dict):
        return {}
    # The shape belongs to the analyst, who has already been shown it.
    options.pop("globalSeriesType", None)
    return options
