"""The public option allowlist, one schema per visualization type.

A deliberate mirror of `app/src/lib/public-report-options.ts`, key for key
and rule for rule. Two copies of one table is a real cost, and it is paid on
purpose: this service answers on its own public ingress, so the browser's copy
guards nobody who calls the API directly, and it is the caller who skips the
browser that this table exists to stop. Keep the two in step; if this one falls
behind, a chart loses the option it needs and renders its own empty state, which
is a visible failure rather than a silent leak.

Options are rebuilt key by key rather than copied, from a schema naming only what
a renderer actually reads (`app/src/components/visualizations/*`). An
option nobody declared does not survive, and a declared option whose value is the
wrong shape is dropped rather than coerced.
"""

from dataclasses import dataclass
from math import isfinite
from typing import Any, TypeAlias


@dataclass(frozen=True)
class StringMap:
    """dict[str, str]: the chart column mapping and nothing else."""


@dataclass(frozen=True)
class Obj:
    fields: "Fields"


@dataclass(frozen=True)
class ObjMap:
    """dict[str, <object>]: keyed series options."""

    fields: "Fields"


@dataclass(frozen=True)
class Arr:
    item: "Rule"


Rule: TypeAlias = "str | StringMap | Obj | ObjMap | Arr"
Fields: TypeAlias = dict[str, Rule]

SERIES_OPTION: Fields = {
    "name": "string",
    "type": "string",
    "color": "string",
    "yAxis": "number",
    "curve": "string",
}

AXIS_OPTION: Fields = {
    "type": "string",
    "opposite": "boolean",
    "rangeMin": "number",
    "rangeMax": "number",
}

REFERENCE_LINE: Fields = {
    "value": "number",
    "label": "string",
    "color": "string",
    "axis": "string",
}

TABLE_COLUMN: Fields = {
    "name": "string",
    "visible": "boolean",
    "order": "number",
    "title": "string",
    "type": "string",
    "displayAs": "string",
}

# min/max bounds, shared by the word cloud's two limits.
WORD_LIMIT: Fields = {"min": "number", "max": "number"}

# One entry per type the renderer's switch can reach. A type missing from here
# gets no options at all, which degrades to the renderer's own "unsupported
# visualization" branch.
PUBLIC_VIZ_OPTIONS: dict[str, Fields] = {
    "CHART": {
        "globalSeriesType": "string",
        "columnMapping": StringMap(),
        "seriesOptions": ObjMap(SERIES_OPTION),
        "yAxis": Arr(Obj(AXIS_OPTION)),
        "xAxis": Obj({"type": "string"}),
        "series": Obj({"stacking": "string"}),
        "stacking": "string",
        "swappedAxes": "boolean",
        "reverseX": "boolean",
        "showDataLabels": "boolean",
        "donut": "boolean",
        "lineStyle": "string",
        "referenceLines": Arr(Obj(REFERENCE_LINE)),
        "legend": Obj({"enabled": "boolean"}),
        "showLegend": "boolean",
        "indexed": "boolean",
    },
    "COUNTER": {
        "counterColName": "string",
        "counterLabel": "string",
        "countRow": "boolean",
        "rowNumber": "number",
        "targetRowNumber": "number",
        "targetColName": "string",
        "stringPrefix": "string",
        "stringSuffix": "string",
        "stringDecimal": "number",
    },
    "TABLE": {"columns": Arr(Obj(TABLE_COLUMN))},
    "MAP": {
        "latColName": "string",
        "lonColName": "string",
        "classify": "string",
        "tooltip": Obj({"enabled": "boolean", "template": "string"}),
        "popup": Obj({"enabled": "boolean", "template": "string"}),
    },
    "CHOROPLETH": {
        "mapType": "string",
        "keyColumn": "string",
        "targetField": "string",
        "valueColumn": "string",
    },
    "PIVOT": {
        "rowField": "string",
        "colField": "string",
        "valueField": "string",
        "aggregation": "string",
    },
    "FUNNEL": {"stepColumn": "string", "valueColumn": "string", "sortOrder": "string"},
    # Column names, not the table's column descriptors: the details renderer
    # reads `options.columns` as a list of names to show.
    "DETAILS": {"columns": Arr("string")},
    "HEATMAP": {
        "columnMapping": StringMap(),
        "aggregation": "string",
        "showValues": "string",
        "clipOutliers": "boolean",
        "sortRows": "string",
    },
    "BOXPLOT": {"columnMapping": StringMap()},
    "SANKEY": {"columnMapping": StringMap()},
    "COHORT": {
        "dateColumn": "string",
        "stageColumn": "string",
        "totalColumn": "string",
        "valueColumn": "string",
        "timeInterval": "string",
        "mode": "string",
    },
    "SUNBURST_SEQUENCE": {"valueColumn": "string"},
    "WORD_CLOUD": {
        "column": "string",
        "frequenciesColumn": "string",
        "wordLengthLimit": Obj(WORD_LIMIT),
        "wordCountLimit": Obj(WORD_LIMIT),
    },
}

# "This value does not belong in an anonymous response." A distinct object rather
# than None, because null is a value an option may legitimately not have and
# conflating the two would let a dropped key look like a kept one.
DROP: Any = object()


def _survivors(out: Any, source_size: int, kept_size: int) -> Any:
    """A container that arrived with entries and kept none was carrying something
    the allowlist refused, so the key goes with it rather than leaving an empty
    shell behind. A container that was already empty is the author's own empty
    value and is kept as it stands."""
    return DROP if source_size > 0 and kept_size == 0 else out


def _sanitize_value(rule: Rule, value: Any) -> Any:
    if rule == "string":
        return value if isinstance(value, str) else DROP
    if rule == "number":
        # bool is a subclass of int in Python, and a boolean where a number was
        # declared is the wrong shape, not a zero.
        ok = isinstance(value, int | float) and not isinstance(value, bool) and isfinite(value)
        return value if ok else DROP
    if rule == "boolean":
        return value if isinstance(value, bool) else DROP

    if isinstance(rule, StringMap):
        if not isinstance(value, dict):
            return DROP
        out = {key: entry for key, entry in value.items() if isinstance(key, str) and isinstance(entry, str)}
        return _survivors(out, len(value), len(out))

    if isinstance(rule, Arr):
        if not isinstance(value, list):
            return DROP
        items = [item for item in (_sanitize_value(rule.item, entry) for entry in value) if item is not DROP]
        return _survivors(items, len(value), len(items))

    if isinstance(rule, ObjMap):
        if not isinstance(value, dict):
            return DROP
        kept: dict[str, Any] = {}
        for key, entry in value.items():
            sanitized = _sanitize_fields(rule.fields, entry)
            if sanitized is not DROP:
                kept[key] = sanitized
        return _survivors(kept, len(value), len(kept))

    if isinstance(rule, Obj):
        return _sanitize_fields(rule.fields, value)

    # A scalar rule name nobody defined. Refusing is the safe reading of a typo
    # in the table above.
    return DROP


def _sanitize_fields(fields: Fields, value: Any) -> Any:
    if not isinstance(value, dict):
        return DROP
    out: dict[str, Any] = {}
    for key, rule in fields.items():
        if key not in value:
            continue
        sanitized = _sanitize_value(rule, value[key])
        if sanitized is not DROP:
            out[key] = sanitized
    return out


def sanitize_viz_options(viz_type: str, options: Any) -> dict[str, Any]:
    """The options a reader may see for one visualization type, rebuilt.

    An unknown type gets nothing, which is the right outcome for a renderer
    nobody has declared a public shape for.
    """
    schema = PUBLIC_VIZ_OPTIONS.get(viz_type)
    if schema is None:
        return {}
    sanitized = _sanitize_fields(schema, options)
    return {} if sanitized is DROP else dict(sanitized)
