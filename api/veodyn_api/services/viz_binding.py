"""Options that name only columns the statement will return.

sanitize_viz_options checks the SHAPE of an option: that swappedAxes is a
boolean and columnMapping is a map of strings. It cannot check that "ghost" is a
column, because it has never seen the query. So a mapping full of invented names
survives it intact and reaches a renderer that draws nothing.

This module is the second pass: every option key that holds a column name is
checked against the statement's own result shape, and one that does not resolve
is dropped by itself rather than taking the object with it. Then the mapping is
completed from the result shape, which is the part that decides whether the chart
is readable at all.
"""

import logging
from typing import Any

from veodyn_api.schemas.public_viz_options import sanitize_viz_options
from veodyn_api.services.result_shape import ResultColumn, columns_named

logger = logging.getLogger(__name__)

# Option keys whose VALUE is a column name. Every entry here is read as
# row[value] by a renderer, so a name the statement does not return is an
# undefined lookup rather than a cosmetic slip. Kept in step with
# PUBLIC_VIZ_OPTIONS; tests/test_viz_binding.py fails when a column-shaped key
# is added there and not here.
COLUMN_KEYS: dict[str, tuple[str, ...]] = {
    "COUNTER": ("counterColName", "targetColName"),
    # classify is not spelled like a column and is one: the map renderer groups
    # markers by row[classify], and an invented name puts every marker in one
    # unnamed group.
    "MAP": ("latColName", "lonColName", "classify"),
    # targetField is deliberately absent: it names a property of the GeoJSON
    # feature, not of the result set, and checking it would drop it always.
    "CHOROPLETH": ("keyColumn", "valueColumn"),
    "PIVOT": ("rowField", "colField", "valueField"),
    "FUNNEL": ("stepColumn", "valueColumn"),
    "COHORT": ("dateColumn", "stageColumn", "totalColumn", "valueColumn"),
    "SUNBURST_SEQUENCE": ("valueColumn",),
    "WORD_CLOUD": ("column", "frequenciesColumn"),
}

# Types whose columnMapping is keyed BY column name.
MAPPING_TYPES = ("CHART", "HEATMAP", "BOXPLOT", "SANKEY")

SCATTER = "chart-scatter"
SERIES_SHAPES = ("chart-line", "chart-area", "chart-bar")


def _drop_unknown(viz_type: str, options: dict[str, Any], known: set[str]) -> dict[str, Any]:
    out = dict(options)
    for key in COLUMN_KEYS.get(viz_type, ()):
        if key in out and out[key] not in known:
            logger.info("dropping %s.%s: the statement returns no column called %r", viz_type, key, out[key])
            del out[key]
    if viz_type in MAPPING_TYPES and isinstance(out.get("columnMapping"), dict):
        mapping = {name: role for name, role in out["columnMapping"].items() if name in known}
        if mapping:
            out["columnMapping"] = mapping
        else:
            del out["columnMapping"]
    if viz_type == "DETAILS" and isinstance(out.get("columns"), list):
        out["columns"] = [name for name in out["columns"] if name in known]
    if viz_type == "TABLE" and isinstance(out.get("columns"), list):
        out["columns"] = [one for one in out["columns"] if isinstance(one, dict) and one.get("name") in known]
    return out


def infer_mapping(shape: str, columns: tuple[ResultColumn, ...]) -> dict[str, str]:
    """The mapping the result shape implies, when the model gave none.

    The frontend has its own version of this (inferChartColumnMapping), and it
    can only see declared types: it takes the first column for x and every
    numeric for y. That is what draws an hour as a measure and a station id as a
    line. Here the kinds come from DESCRIBE and a text column is available to
    split a series, which is the case the frontend cannot express at all.
    """
    if not columns:
        return {}
    measures = [column for column in columns if column.kind == "number"]
    times = [column for column in columns if column.kind == "time"]
    texts = [column for column in columns if column.kind not in ("number", "time")]

    if shape == SCATTER:
        # Two measures related to each other, so there is no series and the first
        # measure is the x rather than a time column.
        if len(measures) < 2:
            return {}
        return {measures[0].name: "x", measures[1].name: "y"}

    x = times[0] if times else (texts[0] if texts else None)
    if x is None or not measures:
        return {}
    mapping = {x.name: "x"}
    remaining = [column for column in texts if column.name != x.name]
    # One measure and one leftover label means the label names the series. With
    # two measures the chart already has two things to draw and a series column
    # would multiply them.
    if shape in SERIES_SHAPES and len(measures) == 1 and len(remaining) == 1:
        mapping[remaining[0].name] = "series"
    for measure in measures:
        mapping[measure.name] = "y"
    return mapping


def bind_options(
    viz_type: str, shape: str, options: dict[str, Any], columns: tuple[ResultColumn, ...]
) -> dict[str, Any]:
    """Sanitized, checked against the real columns, and completed."""
    bound = _drop_unknown(viz_type, sanitize_viz_options(viz_type, options), columns_named(columns))
    if viz_type == "CHART" and not bound.get("columnMapping"):
        mapping = infer_mapping(shape, columns)
        if mapping:
            bound["columnMapping"] = mapping
        else:
            bound.pop("columnMapping", None)
    return bound
