"""Which visualization the model may ask for, and how it is told to choose.

Split out of ai_converse_prompt.py, which is prose for five kinds of proposal.
This is one kind's cosmetic field, and it carries three things that belong
together: the closed list of shapes, what each shape is FOR, and the clamp that
turns whatever the model actually said into one of them.

Nothing here decides what is true, and nothing here can fail a turn. The worst
outcome is a table where a heatmap was wanted, in a card the analyst edits
before pressing Create.
"""

import logging

logger = logging.getLogger(__name__)

# The CORE list of visualization shapes, restated from
# app/src/lib/viz-choices.ts, which is its source. A chart shape is a
# Redash *option* rather than a type, so the model names a shape and
# resolveVizChoice turns it into {type, options} on the frontend. Restated
# rather than derived because this service cannot import TypeScript.
#
# No longer the closed list the chat path uses. A chat turn carries the catalog
# the running image actually registered, packs included, and ai_viz_catalog.py
# renders the model's instructions from that. This is the fallback: the converse
# and outline paths, which have no turn to carry a catalog, and a turn from an
# app too old to send one. A core shape added over there should be added here
# too, for those paths; a PACK shape should not, and cannot be.
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

# Which Redash TYPE each shape produces. Restated from viz-choices.ts beside
# CHOICE_IDS above and for the same reason: this service cannot import
# TypeScript. If a plugin there gains a choice, add it in both places.
#
# Needed because the option surface is per TYPE: five of the ids below are one
# CHART with a different globalSeriesType, and asking the model for "the options
# for chart-line" would mean maintaining a fourteenth option table for a
# distinction the renderer does not make.
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

# What a model says when it means one of the ids above. Every entry here was a
# table on somebody's dashboard: the clamp below has always fallen back to
# "table", so "bar" and "chart_bar" were indistinguishable from "chart-hologram"
# and silently produced a grid of numbers. Normalization runs first (lowercased,
# separators to "-"), so this only has to carry genuinely different words.
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

# The guide goes in the SYSTEM block, not into the field description: it is one
# body of reasoning shared by the query kind and by every widget of a dashboard,
# and repeating it per field spends prompt budget the transcript needs.
#
# It is written as "what the result looks like -> which shape", because that is
# the only thing the model knows at this point. It has just described an intent;
# no SQL has run and no row exists. Naming the shape of the RESULT is a
# question it can answer from its own intent, where "pick a nice chart" is not.
#
# Split into head, bullets and tail so that ai_viz_catalog.py can render the
# same prose over a DIFFERENT set of shapes. The head and the tail are about how
# to choose and hold for any catalog; only the bullets are per shape.
RULES_HEAD = """How to show the result (`vizChoiceId`):

Work from the shape of the result your intent will produce, then name the id.
"""

RULES_TAIL = """
Two things to get right, because neither is recoverable afterwards:
- Do not fall back to `table` for a result that has a shape. A query that groups by something and
  returns a number is a chart. Hundreds of rows in a table is not something anyone reads.
- Copy the id EXACTLY as written above. An id we do not recognize is shown as a table."""

# What each core shape is FOR.
#
# These are a FALLBACK copy. The live source is
# app/src/lib/visualizations/choice-guides.ts, which travels to this service in
# the per-turn catalog (see ai_viz_catalog.py), because only the app knows which
# shapes the running image actually registers. This copy is what the converse
# and outline paths use, since they have no catalog, and what chat falls back to
# when an older app sends no vizCatalog. Edit the TypeScript first; keep this in
# step for the paths that cannot read it.
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
    """The shape guide as prose, over whichever shapes are on offer."""
    bullets = "\n".join(f"- `{choice_id}`: {guide}" for choice_id, guide in guides)
    return f"{RULES_HEAD}\n{bullets}\n{RULES_TAIL}"


# In DEFAULT_GUIDES' own order, NOT in CHOICE_IDS order. The bullets are an
# argument, not an index: they run from the most specific shape to the least, so
# that "the LAST resort, for a result no shape above fits" and "copy the id
# EXACTLY as written above" both have something above them to refer to.
# CHOICE_IDS starts with `table`, which would put the last resort first.
VIZ_RULES = rules_for(list(DEFAULT_GUIDES.items()))

# The field description stays short and points at the guide, so the two cannot
# drift into saying different things.
VIZ_FIELD_DESCRIPTION = f"How to show the result. One of: {', '.join(CHOICE_IDS)}. See the shape guide."


def normalized(value: str) -> str:
    """Lowercased, with any separator run reduced to a single "-"."""
    out: list[str] = []
    for char in value.strip().lower():
        if char.isalnum():
            out.append(char)
        elif out and out[-1] != "-":
            out.append("-")
    return "".join(out).strip("-")


def viz_choice(value: object) -> str:
    """One of CHOICE_IDS: what the model said, or the table.

    Aliased rather than clamped where the meaning is unambiguous. "bar" is not a
    shape this build offers and is also not a shape anybody could mean anything
    else by, and the alternative was a bar chart's worth of data in a grid.

    A value that survives normalization and aliasing without matching is logged,
    because the silent version of this is unfalsifiable: a dashboard of tables
    looks exactly the same whether the model chose them or misnamed them.
    """
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
    """The Redash type a shape produces, or the table for one we do not know."""
    return CHOICE_TYPE.get(choice_id, "TABLE")


def choice_id_for(viz_type: str, options: dict[str, object] | None = None) -> str:
    """The shape id a STORED visualization amounts to.

    The inverse of viz_type_for, and needed because an edit conversation has to
    be told what each widget is drawn as today. Without it the model asks the
    analyst which widgets are tables, which is a question the dashboard already
    answers.

    CHOICE_TYPE is not injective: five ids are a CHART told apart by
    `globalSeriesType`, so for a chart the options decide. The series name is put
    through viz_choice rather than matched directly, because Redash writes
    `column` for what this build calls a bar and the alias table already knows
    that.
    """
    wanted = (viz_type or "").strip().upper()
    if wanted == CHOICE_TYPE["chart-line"]:
        series = str((options or {}).get("globalSeriesType") or "").strip()
        # A chart whose series type is missing or unrecognized is still a chart.
        # Falling through to viz_choice's table default would tell the model a
        # chart is a table and invite it to "fix" one that is already fine.
        picked = viz_choice(series) if series else ""
        return picked if picked.startswith("chart-") else "chart-line"
    for choice_id, mapped in CHOICE_TYPE.items():
        if mapped == wanted:
            return choice_id
    return DEFAULT_CHOICE_ID
