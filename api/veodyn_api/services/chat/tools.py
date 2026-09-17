import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from veodyn_api.errors import ApiError
from veodyn_api.schemas.ai import AiDatasetIn
from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.services.ai_converse_prompt import picked_id, text_of
from veodyn_api.services.ai_sql import QUERYABLE_TABLE_RE, UngroundedSql, validate_sql
from veodyn_api.services.ai_viz_choice import VIZ_FIELD_DESCRIPTION, viz_choice

MAX_NAMED_TABLES = 20
LIBRARY_KINDS = ("query", "dashboard")
MAX_SEARCH_TAGS = 5
SECOND_REFUSAL = (
    " This is the second refusal in this turn: stop writing SQL and tell the analyst what you could not do."
)


@dataclass(frozen=True)
class ClientCall:
    call_id: str
    tool: str
    args: dict[str, Any]


@dataclass(frozen=True)
class Immediate:
    content: str
    is_error: bool
    draft: dict[str, Any] | None = None


SaveDraft = Callable[[str | None, dict[str, Any]], Awaitable[tuple[str, int]]]


@dataclass
class ToolContext:
    datasets: tuple[DatasetOut, ...]
    data_source_id: Callable[[], Awaitable[int]]
    save_draft: SaveDraft
    refusals: int = field(default=0)


Handler = Callable[[str, dict[str, Any], ToolContext], Awaitable[ClientCall | Immediate]]


@dataclass(frozen=True)
class ChatTool:
    name: str
    definition: dict[str, Any]
    handler: Handler
    result_kind: str | None = None


_TOOLS: dict[str, ChatTool] = {}


def register_chat_tool(tool: ChatTool) -> None:
    if tool.name in _TOOLS:
        raise ValueError(f"a chat tool called {tool.name!r} is already registered")
    if tool.definition.get("name") != tool.name:
        raise ValueError(f"the definition of {tool.name!r} names a different tool")
    _TOOLS[tool.name] = tool


def result_kind_for(tool: str) -> str | None:
    found = _TOOLS.get(tool)
    return found.result_kind if found else None


def tool_definitions() -> list[dict[str, Any]]:
    return [dict(tool.definition) for tool in _TOOLS.values()]


async def prepare_call(block: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    name = str(block.get("name") or "")
    tool = _TOOLS.get(name)
    if tool is None:
        return Immediate(f"there is no tool called {name!r}", is_error=True)
    arguments = block.get("input")
    return await tool.handler(str(block.get("id") or ""), arguments if isinstance(arguments, dict) else {}, ctx)


def _resolve(ctx: ToolContext, arguments: dict[str, Any]) -> DatasetOut | Immediate:
    wanted = text_of(arguments.get("datasetTable"), 255).lower()
    queryable = [one for one in ctx.datasets if QUERYABLE_TABLE_RE.match(one.id)]
    exact = [one for one in queryable if one.id.lower() == wanted]
    bare = [one for one in queryable if one.id.lower().rpartition(".")[2] == wanted.rpartition(".")[2]]
    if wanted and exact:
        return exact[0]
    if wanted and len(bare) == 1:
        return bare[0]
    names = ", ".join(one.id for one in queryable[:MAX_NAMED_TABLES]) or "none"
    return Immediate(f"there is no table called {wanted!r}. The tables you may read are: {names}", is_error=True)


def _checked_sql(ctx: ToolContext, arguments: dict[str, Any], dataset: DatasetOut) -> str | Immediate:
    try:
        return validate_sql(text_of(arguments.get("sql"), 50_000), AiDatasetIn(table=dataset.id, columns=[]))
    except UngroundedSql as refused:
        ctx.refusals += 1
        message = f"the SQL was refused because {refused}. Rewrite it."
        return Immediate(message + (SECOND_REFUSAL if ctx.refusals >= 2 else ""), is_error=True)


async def _run_query(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    dataset = _resolve(ctx, arguments)
    if isinstance(dataset, Immediate):
        return dataset
    sql = _checked_sql(ctx, arguments, dataset)
    if isinstance(sql, Immediate):
        return sql
    try:
        data_source_id = await ctx.data_source_id()
    except ApiError as unresolvable:
        return Immediate(f"the query cannot run on this instance: {unresolvable.message}", is_error=True)
    return ClientCall(
        call_id=call_id,
        tool="run_query",
        args={
            "dataSourceId": data_source_id,
            "sql": sql,
            "purpose": text_of(arguments.get("purpose"), 200),
            "vizChoiceId": viz_choice(arguments.get("vizChoiceId")),
        },
    )


async def _propose_query(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    dataset = _resolve(ctx, arguments)
    if isinstance(dataset, Immediate):
        return dataset
    sql = _checked_sql(ctx, arguments, dataset)
    if isinstance(sql, Immediate):
        return sql
    payload = {
        "name": text_of(arguments.get("name"), 255) or dataset.name,
        "description": text_of(arguments.get("description"), 4_000),
        "sql": sql,
        "datasetTable": dataset.id,
        "vizChoiceId": viz_choice(arguments.get("vizChoiceId")),
        "vizOptions": {},
    }
    draft_id, version = await ctx.save_draft(text_of(arguments.get("draftId"), 64) or None, payload)
    return Immediate(
        json.dumps(
            {
                "draftId": draft_id,
                "version": version,
                "saved": False,
                "note": "The analyst sees this as a card with a Save button. Nothing is saved until they click it.",
            }
        ),
        is_error=False,
        draft={"draftId": draft_id, "version": version, "kind": "query", "payload": payload},
    )


def _positive_id(value: Any) -> int | None:
    number = picked_id(value)
    return number if number is not None and number > 0 else None


def _strings(value: Any, limit: int) -> list[str]:
    return (
        [text_of(one, limit) for one in value if isinstance(one, str) and one.strip()]
        if isinstance(value, list)
        else []
    )


async def _search_library(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    text = text_of(arguments.get("text"), 200)
    tags = _strings(arguments.get("tags"), 64)[:MAX_SEARCH_TAGS]
    asked = arguments.get("kinds")
    kinds = [kind for kind in LIBRARY_KINDS if not isinstance(asked, list) or kind in asked]
    if not kinds:
        return Immediate(f"kinds must name at least one of {', '.join(LIBRARY_KINDS)}", is_error=True)
    if not text and not tags:
        return Immediate("give some text or at least one tag to search for", is_error=True)
    return ClientCall(call_id=call_id, tool="search_library", args={"text": text, "kinds": kinds, "tags": tags})


async def _show_visualization(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    query_id = _positive_id(arguments.get("queryId"))
    if query_id is None:
        return Immediate("queryId must be the id of a query from a search result", is_error=True)
    raw = arguments.get("visualizationId")
    visualization_id = _positive_id(raw)
    if raw is not None and visualization_id is None:
        return Immediate("visualizationId must be the id of one of the query's visualizations", is_error=True)
    return ClientCall(
        call_id=call_id,
        tool="show_visualization",
        args={"queryId": query_id, "visualizationId": visualization_id},
    )


async def _open_dashboard(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    dashboard_id = _positive_id(arguments.get("dashboardId"))
    if dashboard_id is None:
        return Immediate("dashboardId must be the id of a dashboard from a search result", is_error=True)
    return ClientCall(call_id=call_id, tool="open_dashboard", args={"dashboardId": dashboard_id})


def _string(description: str) -> dict[str, str]:
    return {"type": "string", "description": description}


def _integer(description: str) -> dict[str, str]:
    return {"type": "integer", "description": description}


RUN_QUERY = ChatTool(
    name="run_query",
    definition={
        "name": "run_query",
        "description": (
            "Run one read-only ClickHouse SELECT over one table from the catalog, in the analyst's browser under "
            "their own permissions. Returns the row count, statistics over the full result and at most 50 sample "
            "rows. The analyst sees the full result drawn with vizChoiceId."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "datasetTable": _string("The `table` of one catalog entry, copied exactly."),
                "sql": _string("One SELECT statement (a leading WITH is fine) that reads only that table."),
                "purpose": _string("What this query finds out, in a few words the analyst will see."),
                "vizChoiceId": _string(VIZ_FIELD_DESCRIPTION),
            },
            "required": ["datasetTable", "sql", "purpose", "vizChoiceId"],
        },
    },
    handler=_run_query,
    result_kind="query_result",
)

PROPOSE_QUERY = ChatTool(
    name="propose_query",
    definition={
        "name": "propose_query",
        "description": (
            "Offer a query the analyst can save to the platform. Nothing is saved until they click Save. Pass "
            "draftId to revise a query you proposed earlier in this conversation."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "draftId": _string("The draftId of an earlier proposal to revise. Omit for a new one."),
                "name": _string("A short name for the saved query."),
                "description": _string("One sentence on what the query answers."),
                "datasetTable": _string("The `table` of one catalog entry, copied exactly."),
                "sql": _string("One SELECT statement (a leading WITH is fine) that reads only that table."),
                "vizChoiceId": _string(VIZ_FIELD_DESCRIPTION),
            },
            "required": ["name", "datasetTable", "sql", "vizChoiceId"],
        },
    },
    handler=_propose_query,
)

SEARCH_LIBRARY = ChatTool(
    name="search_library",
    definition={
        "name": "search_library",
        "description": (
            "Search the saved queries and dashboards the analyst can see, by text in their names and descriptions "
            "and by tag. Returns at most 10 of each kind with ids, descriptions, tags and whether a query has a "
            "stored result."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "text": _string("Words to look for. May be empty when tags are given."),
                "kinds": {
                    "type": "array",
                    "items": {"type": "string", "enum": list(LIBRARY_KINDS)},
                    "description": "Which kinds to search. Both when omitted.",
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Only items carrying all of these tags.",
                },
            },
            "required": ["text"],
        },
    },
    handler=_search_library,
    result_kind="library",
)

SHOW_VISUALIZATION = ChatTool(
    name="show_visualization",
    definition={
        "name": "show_visualization",
        "description": (
            "Show one of a saved query's visualizations to the analyst, drawn from the query's latest stored result. "
            "It never runs the query. Returns the query's SQL, its visualizations, when the result was retrieved, "
            "the row count, column statistics and at most 50 sample rows."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "queryId": _integer("The id of a query from a search result or a dashboard widget."),
                "visualizationId": _integer(
                    "The id of one of the query's visualizations. Omit to show its main chart."
                ),
            },
            "required": ["queryId"],
        },
    },
    handler=_show_visualization,
    result_kind="saved_visualization",
)

OPEN_DASHBOARD = ChatTool(
    name="open_dashboard",
    definition={
        "name": "open_dashboard",
        "description": (
            "Read a dashboard's widgets: each one's title, query and visualization. The analyst gets a link to the "
            "dashboard. Use show_visualization to show a widget's chart."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"dashboardId": _integer("The id of a dashboard from a search result.")},
            "required": ["dashboardId"],
        },
    },
    handler=_open_dashboard,
    result_kind="dashboard",
)

for _tool in (RUN_QUERY, PROPOSE_QUERY, SEARCH_LIBRARY, SHOW_VISUALIZATION, OPEN_DASHBOARD):
    register_chat_tool(_tool)
