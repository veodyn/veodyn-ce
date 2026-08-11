"""What the model is allowed to name: the lookups that answer it.

Every AI route here answers with something that points at real content: an
outline section names a query, a digest item names a KPI, a report block links a
query id. None of those ids may come from the model. The model chooses FROM a
list assembled out of these calls, and the caller checks its choice against the
same list, so the worst a bad generation can do is point at the wrong real thing
rather than at something that does not exist.

Per-kind assembly and its TTL cache are ai_converse_grounding.py. This file is
the stateless half: one function per thing there is to look up.

The credential is the Redash service account, not the reader. The relay in
veodyn-de strips the browser cookie before calling out (the provider endpoint
may be a third party), so this service has no way to know who is asking. The
consequence is deliberate and worth stating: a suggestion can NAME a query the
reader cannot open. It cannot show its contents, because reading a result still
goes through Redash under the reader's own credential.
"""

import logging
from dataclasses import dataclass, field
from typing import Any

from veodyn_api.errors import ApiError
from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.services.redash import RedashClient

# Redash's own type string for the visualization every query gets whether anyone
# wanted it or not. It is the fallback here, never the preference: a query
# carrying any other type is carrying one somebody configured.
TABLE_TYPE = "TABLE"

# The catalog is the one grounding list with no ceiling of its own. Queries are
# capped by ai_max_grounded_queries and columns by MAX_GROUNDED_COLUMNS, but
# build_catalog answers with every table the warehouse has, so an instance
# capturing two hundred feeds builds a system prompt nothing bounds. That does
# not fail cleanly: it spends the budget the conversation needs, and past the
# context window it surfaces as a provider 400 relayed as "AI is broken".
#
# Freshest first, because a chat about what is happening is a chat about a table
# something is still writing to. What falls off the end is logged rather than
# dropped quietly: a user asking for a table the model was never shown gets told
# it does not exist, which is a confusing answer to debug from the outside.
MAX_GROUNDED_DATASETS = 40


logger = logging.getLogger(__name__)


def bounded_datasets(datasets: list[DatasetOut]) -> tuple[DatasetOut, ...]:
    """The freshest MAX_GROUNDED_DATASETS tables, and a log line if any fell off."""
    ordered = sorted(datasets, key=lambda dataset: dataset.freshness.last_updated_at, reverse=True)
    if len(ordered) > MAX_GROUNDED_DATASETS:
        dropped = [dataset.id for dataset in ordered[MAX_GROUNDED_DATASETS:]]
        logger.warning(
            "grounding kept the %d freshest datasets and dropped %d: %s",
            MAX_GROUNDED_DATASETS,
            len(dropped),
            ", ".join(dropped[:20]),
        )
    return tuple(ordered[:MAX_GROUNDED_DATASETS])


@dataclass(frozen=True)
class GroundedQuery:
    """A query the model may name, reduced to what belongs in a prompt."""

    id: int
    name: str
    description: str
    tags: list[str]
    updated_at: str
    # The data source it runs against, by name. See ai_data_sources.py for why a
    # model that cannot see this answers questions about it from its priors.
    source: str = ""

    def as_prompt_row(self) -> dict[str, Any]:
        row: dict[str, Any] = {"id": self.id, "name": self.name}
        if self.description:
            row["about"] = self.description[:300]
        if self.tags:
            row["tags"] = self.tags
        if self.source:
            row["reads"] = self.source
        return row


@dataclass(frozen=True)
class QueryVisualization:
    """One visualization a query already has.

    `options` is carried because a chart SHAPE is an option, not a type: five of
    the ids in ai_viz_choice.CHOICE_IDS are a CHART with a different
    `globalSeriesType`, so matching "make it a bar chart" on the type alone would
    answer with whichever chart the query happens to have.
    """

    id: int
    type: str
    options: dict[str, Any]


@dataclass(frozen=True)
class DashboardWidget:
    widget_id: int
    query_id: int
    query_name: str
    # What the widget draws TODAY. Without these an edit conversation is told
    # which queries the dashboard holds and nothing about how they are drawn, so
    # a model asked to improve the visualizations has to ask the analyst which
    # ones are currently tables. They are also the fallback that keeps a widget
    # whose visualization stops resolving mid-conversation from being proposed
    # away: see _nothing_removed.
    viz_id: int = 0
    viz_type: str = ""
    # The chart's own options, because the SHAPE of a chart is an option and not
    # a type. Without them every CHART on the dashboard is described to the model
    # as a line chart, and "change the line charts and leave the bars alone"
    # rewrites the bars.
    viz_options: dict[str, Any] = field(default_factory=dict)


def _text(value: Any, limit: int = 500) -> str:
    return str(value).strip()[:limit] if isinstance(value, str) else ""


def list_queries(redash: RedashClient, api_key: str, limit: int, sources: dict[int, str]) -> list[GroundedQuery]:
    """Published queries the service account can see, newest first.

    Redash excludes drafts from this listing, which is the behaviour we want: an
    unfinished query is not something to build a report section on.

    `sources` labels each row with the data source it reads (ai_data_sources.py).
    An empty map leaves every label blank, which is the honest reading of a
    lookup that did not answer.
    """
    rows = redash.list_tagged("queries", "", api_key=api_key, page_size=min(limit, 250))
    queries = [
        GroundedQuery(
            id=int(row["id"]),
            name=_text(row.get("name")) or f"Query {row['id']}",
            description=_text(row.get("description"), 1_000),
            tags=[_text(tag, 60) for tag in row.get("tags") or [] if isinstance(tag, str)],
            updated_at=_text(row.get("updated_at"), 64),
            source=sources.get(row.get("data_source_id") or 0, ""),
        )
        for row in rows
        if isinstance(row.get("id"), int)
    ]
    queries.sort(key=lambda query: query.updated_at, reverse=True)
    return queries[:limit]


def query_chart_config(redash: RedashClient, query_id: int, api_key: str) -> dict[str, Any] | None:
    """The query's own visualization, if it has one worth reusing.

    A report block reuses what the query's author already configured rather than
    inventing a chart. If there is nothing but the table, the caller falls back
    to a table block, which every query can render.

    Any type but TABLE, not CHART alone. A query whose best shape is a counter
    or a heatmap had its report block degraded to a grid of numbers, which is the
    same defect the shape guide in ai_viz_choice.py exists to stop upstream: no
    point teaching the model to choose a heatmap if the report then ignores it.
    The report renderer resolves the type through the plugin registry and
    sanitizes options per type, so it draws whatever the query carries.
    """
    payload = redash.get_query(query_id, api_key=api_key)
    for visualization in payload.get("visualizations") or []:
        if not isinstance(visualization, dict):
            continue
        viz_type = _text(visualization.get("type"))
        if not viz_type or viz_type == TABLE_TYPE:
            continue
        options = visualization.get("options")
        return {
            "type": viz_type,
            "name": _text(visualization.get("name")) or None,
            "options": options if isinstance(options, dict) else {},
        }
    return None


def default_visualization(options: tuple[QueryVisualization, ...]) -> QueryVisualization | None:
    """The one a widget should point at when nobody asked for a shape.

    A chart when the query's author configured one, its table otherwise. Any
    configured shape beats the table Redash creates for every query, for the same
    reason as query_chart_config above: a widget pointing at the table shows a
    grid where the author built a counter.

    None means the query has no visualization at all, which for a query that
    exists means it went away between the listing and the lookup. The caller
    drops that widget.
    """
    return next((one for one in options if one.type != TABLE_TYPE), None) or next(iter(options), None)


def query_result_columns(redash: RedashClient, query_id: int, api_key: str) -> tuple[str, ...]:
    """The column names a query's last cached result carried, or () if unknown.

    A listing row does not carry columns, only `latest_query_data_id`, so this
    costs a second call and a whole result body. That is why it is looked up for
    the ONE query a proposal actually names rather than for the grounding list:
    the same economy _dashboard_proposal already makes for visualization ids.

    () is "we could not find out", never "it has none", and the caller treats it
    that way. A KPI proposal is not worth refusing over a Redash hiccup.
    """
    try:
        payload = redash.get_query(query_id, api_key=api_key)
        result_id = payload.get("latest_query_data_id")
        if not isinstance(result_id, int):
            return ()
        data = redash.get_query_result(result_id, api_key=api_key)
    except ApiError:
        logger.info("could not read the columns of query %s; the value column goes unchecked", query_id)
        return ()
    # Walked with isinstance rather than chained .get(): the client only checks
    # that the top-level body is an object, so a result whose `data` is a string
    # would raise AttributeError HERE, outside the except above, and take down a
    # proposal this function exists to avoid refusing.
    result = data.get("query_result")
    inner = result.get("data") if isinstance(result, dict) else None
    columns = inner.get("columns") if isinstance(inner, dict) else None
    if not isinstance(columns, list):
        return ()
    return tuple(str(column["name"]) for column in columns if isinstance(column, dict) and column.get("name"))


def dashboard_widgets(redash: RedashClient, dashboard_id: int, api_key: str) -> list[DashboardWidget]:
    """The dashboard's query-backed widgets, in dashboard order.

    Textbox widgets have no visualization and are skipped: there is no series to
    find an event in.
    """
    payload = redash.get_dashboard(dashboard_id, api_key=api_key)
    widgets: list[DashboardWidget] = []
    for widget in payload.get("widgets") or []:
        if not isinstance(widget, dict):
            continue
        visualization = widget.get("visualization")
        if not isinstance(visualization, dict):
            continue
        query = visualization.get("query")
        if not isinstance(query, dict) or not isinstance(query.get("id"), int):
            continue
        widgets.append(
            DashboardWidget(
                widget_id=int(widget.get("id") or 0),
                query_id=int(query["id"]),
                query_name=_text(query.get("name")) or f"Query {query['id']}",
                viz_id=visualization["id"] if isinstance(visualization.get("id"), int) else 0,
                viz_type=_text(visualization.get("type"), 32),
                viz_options=options if isinstance(options := visualization.get("options"), dict) else {},
            )
        )
    return widgets


def query_visualizations(redash: RedashClient, query_id: int, api_key: str) -> tuple[QueryVisualization, ...]:
    """Every visualization the query has, so a chosen shape can be matched to one.

    query_visualization_id below answers a narrower question ("which one should a
    widget point at by default") and is still what a creation turn wants. This is
    the edit turn's question: the model asked for a bar chart, and whether the
    query already HAS one decides between pointing a widget at it and creating
    it, which is the difference between an edit that touches only the dashboard
    and one that has to write to a saved query somebody else owns.
    """
    payload = redash.get_query(query_id, api_key=api_key)
    found: list[QueryVisualization] = []
    for visualization in payload.get("visualizations") or []:
        if not isinstance(visualization, dict) or not isinstance(visualization.get("id"), int):
            continue
        options = visualization.get("options")
        found.append(
            QueryVisualization(
                id=int(visualization["id"]),
                type=_text(visualization.get("type"), 32) or TABLE_TYPE,
                options=options if isinstance(options, dict) else {},
            )
        )
    return tuple(found)
