"""What the model is allowed to name: the lookups that answer it.

No id may come from the model. It chooses FROM a list assembled out of these
calls and the caller checks its choice against the same list, so the worst a bad
generation can do is point at the wrong real thing.

Per-kind assembly and its TTL cache are ai_converse_grounding.py. This file is
the stateless half: one function per thing there is to look up.

The credential is the Redash service account, not the reader: the relay in
veodyn-de strips the browser cookie before calling out. So a suggestion can NAME
a query the reader cannot open, but not show its contents, because reading a
result still goes through Redash under the reader's own credential.
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

# build_catalog answers with every table the warehouse has, so this is the
# catalog's own prompt ceiling: past the context window an unbounded list
# surfaces as a provider 400. Freshest first, and what falls off is logged.
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
    # The data source it runs against, by name. See ai_data_sources.py.
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
    `globalSeriesType`.
    """

    id: int
    type: str
    options: dict[str, Any]


@dataclass(frozen=True)
class DashboardWidget:
    widget_id: int
    query_id: int
    query_name: str
    # What the widget draws TODAY, so an edit conversation can be told how each
    # query is drawn. Also the fallback in _nothing_removed.
    viz_id: int = 0
    viz_type: str = ""
    # The chart's own options, because the SHAPE of a chart is an option and not
    # a type: without them every CHART is described to the model as a line chart.
    viz_options: dict[str, Any] = field(default_factory=dict)


def _text(value: Any, limit: int = 500) -> str:
    return str(value).strip()[:limit] if isinstance(value, str) else ""


def list_queries(redash: RedashClient, api_key: str, limit: int, sources: dict[int, str]) -> list[GroundedQuery]:
    """Published queries the service account can see, newest first.

    Redash excludes drafts from this listing. `sources` labels each row with the
    data source it reads (ai_data_sources.py); an empty map leaves every label
    blank, which is the honest reading of a lookup that did not answer.
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

    A report block reuses what the query's author configured; with nothing but
    the table, the caller falls back to a table block. Any type but TABLE, not
    CHART alone, since the report renderer resolves the type through the plugin
    registry and sanitizes options per type.
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

    Any configured shape beats the table Redash creates for every query. None
    means the query has no visualization at all, and the caller drops that widget.
    """
    return next((one for one in options if one.type != TABLE_TYPE), None) or next(iter(options), None)


def query_result_columns(redash: RedashClient, query_id: int, api_key: str) -> tuple[str, ...]:
    """The column names a query's last cached result carried, or () if unknown.

    A listing row carries only `latest_query_data_id`, so this costs a second
    call and a whole result body: looked up for the ONE query a proposal names,
    never for the grounding list. () is "we could not find out", never "it has
    none", and the caller treats it that way.
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
    # would raise AttributeError outside the except above.
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

    The edit turn's question: whether the query already HAS the asked-for shape
    decides between pointing a widget at it and writing to a saved query somebody
    else owns. A creation turn wants default_visualization instead.
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
