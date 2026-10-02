import logging

logger = logging.getLogger(__name__)

CHOICE_IDS = (
    "table",
    "chart-line",
    "chart-bar",
    "chart-area",
    "chart-pie",
    "chart-scatter",
    "counter",
    "pivot",
    "funnel",
    "details",
    "map",
    "heatmap",
    "boxplot",
    "sankey",
)
DEFAULT_CHOICE_ID = "table"

CHOICE_TYPE: dict[str, str] = {
    "table": "TABLE",
    "chart-line": "CHART",
    "chart-bar": "CHART",
    "chart-area": "CHART",
    "chart-pie": "CHART",
    "chart-scatter": "CHART",
    "counter": "COUNTER",
    "pivot": "PIVOT",
    "funnel": "FUNNEL",
    "details": "DETAILS",
    "map": "MAP",
    "heatmap": "HEATMAP",
    "boxplot": "BOXPLOT",
    "sankey": "SANKEY",
}

_ALIASES = {
    "bar": "chart-bar",
    "bar-chart": "chart-bar",
    "bars": "chart-bar",
    "column": "chart-bar",
    "column-chart": "chart-bar",
    "line": "chart-line",
    "line-chart": "chart-line",
    "lines": "chart-line",
    "timeseries": "chart-line",
    "time-series": "chart-line",
    "trend": "chart-line",
    "area": "chart-area",
    "area-chart": "chart-area",
    "stacked-area": "chart-area",
    "pie": "chart-pie",
    "pie-chart": "chart-pie",
    "donut": "chart-pie",
    "doughnut": "chart-pie",
    "scatter": "chart-scatter",
    "scatter-plot": "chart-scatter",
    "scatterplot": "chart-scatter",
    "bubble": "chart-scatter",
    "chart": "chart-line",
    "number": "counter",
    "single-number": "counter",
    "single-value": "counter",
    "big-number": "counter",
    "metric": "counter",
    "stat": "counter",
    "kpi": "counter",
    "matrix": "heatmap",
    "heat-map": "heatmap",
    "grid": "heatmap",
    "pivot-table": "pivot",
    "crosstab": "pivot",
    "cross-tab": "pivot",
    "box": "boxplot",
    "box-plot": "boxplot",
    "distribution": "boxplot",
    "geo": "map",
    "geo-map": "map",
    "markers": "map",
    "flow": "sankey",
    "flows": "sankey",
    "detail": "details",
    "record": "details",
    "data-table": "table",
    "datatable": "table",
    "rows": "table",
    "list": "table",
}

RULES_HEAD = """How to show the result (`vizChoiceId`):

Work from the shape of the result your intent will produce, then name the id.
"""

RULES_TAIL = """
Two things to get right, because neither is recoverable afterwards:
- Do not fall back to `table` for a result that has a shape. A query that groups by something and
  returns a number is a chart. Hundreds of rows in a table is not something anyone reads.
- Copy the id EXACTLY as written above. An id we do not recognize is shown as a table."""

DEFAULT_GUIDES: dict[str, str] = {
    "counter": "one row, one number. Any aggregate with no GROUP BY.",
    "chart-line": "a time column plus one or more measures. The default for anything over time.",
    "chart-area": "as line, when the measures stack into a total worth seeing.",
    "chart-bar": (
        "one grouping column plus one measure, at most about 25 groups. This is the shape for a "
        "ranking, a top-N, or a per-category comparison."
    ),
    "chart-pie": "one grouping column plus one measure that are parts of a whole, at most about 8 groups.",
    "chart-scatter": "two measures, one point per row, to show how they relate.",
    "heatmap": (
        "TWO grouping columns plus one measure, e.g. one row per station per hour. Order the SELECT "
        "so the two grouping columns come first and the measure last."
    ),
    "pivot": "the same shape as heatmap, when the reader needs to read the numbers rather than see a pattern.",
    "map": "latitude and longitude columns. Alias them exactly `lat` and `lon` in the SELECT.",
    "funnel": "ordered stages, one count each, each stage a subset of the one before.",
    "boxplot": "a distribution: many observations per category.",
    "sankey": "flow between two node columns, with a weight.",
    "details": "a single row read as a list of fields.",
    "table": (
        "the LAST resort, for a result no shape above fits: many columns of mixed types, or rows a "
        "reader must scan one by one."
    ),
}


def rules_for(guides: list[tuple[str, str]]) -> str:
    bullets = "\n".join(f"- `{choice_id}`: {guide}" for choice_id, guide in guides)
    return f"{RULES_HEAD}\n{bullets}\n{RULES_TAIL}"


VIZ_RULES = rules_for(list(DEFAULT_GUIDES.items()))

VIZ_FIELD_DESCRIPTION = f"How to show the result. One of: {', '.join(CHOICE_IDS)}. See the shape guide."


def normalized(value: str) -> str:
    out: list[str] = []
    for char in value.strip().lower():
        if char.isalnum():
            out.append(char)
        elif out and out[-1] != "-":
            out.append("-")
    return "".join(out).strip("-")


def viz_choice(value: object) -> str:
    picked = normalized(str(value or ""))[:64]
    if picked in CHOICE_IDS:
        return picked
    aliased = _ALIASES.get(picked)
    if aliased is not None:
        return aliased
    if picked:
        logger.warning("vizChoiceId %r is not a shape this build offers; showing a table instead", picked)
    return DEFAULT_CHOICE_ID


def viz_type_for(choice_id: str) -> str:
    return CHOICE_TYPE.get(choice_id, "TABLE")


def choice_id_for(viz_type: str, options: dict[str, object] | None = None) -> str:
    wanted = (viz_type or "").strip().upper()
    if wanted == CHOICE_TYPE["chart-line"]:
        series = str((options or {}).get("globalSeriesType") or "").strip()
        picked = viz_choice(series) if series else ""
        return picked if picked.startswith("chart-") else "chart-line"
    for choice_id, mapped in CHOICE_TYPE.items():
        if mapped == wanted:
            return choice_id
    return DEFAULT_CHOICE_ID
