import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from veodyn_api.errors import ApiError
from veodyn_api.schemas.ai import AiDatasetIn
from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.services.ai_converse_prompt import picked_id, text_of
from veodyn_api.services.ai_sql import QUERYABLE_TABLE_RE, UngroundedSql, validate_generic_sql, validate_sql
from veodyn_api.services.ai_viz_catalog import DEFAULT_CATALOG, VizCatalog
from veodyn_api.services.ai_viz_choice import VIZ_FIELD_DESCRIPTION
from veodyn_api.services.chat.help_index import load_index, shown_id

MAX_NAMED_TABLES = 20
LIBRARY_KINDS = ("query", "dashboard")
MAX_SEARCH_TAGS = 5
MAX_HELP_LINKS = 3
MAX_HELP_SUGGESTIONS = 5
MAX_RESOURCE_CALL_CHARS = 4_000
SECOND_REFUSAL = (
    " This is the second refusal in this turn: stop writing SQL and tell the analyst what you could not do."
)
CANNOT_QUERY_YET = "chat cannot query this data source yet"


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
    frame: tuple[str, dict[str, Any]] | None = None


SaveDraft = Callable[[str, str | None, dict[str, Any]], Awaitable[tuple[str, int]]]


@dataclass(frozen=True)
class DataSourceInfo:
    syntax: str
    view_only: bool | None = None
    resources: dict[str, tuple[str, ...]] | None = None


@dataclass
class ToolContext:
    datasets: tuple[DatasetOut, ...]
    data_source_id: Callable[[], Awaitable[int]]
    data_source_info: Callable[[int], DataSourceInfo | None]
    save_draft: SaveDraft
    query_draft_exists: Callable[[str], Awaitable[bool]]
    # The shapes this instance offers. Defaulted so a caller that does not care
    # about visualizations (every test of the SQL guards, among others) is
    # unaffected, and so an older app sending no catalog gets today's list.
    catalog: VizCatalog = DEFAULT_CATALOG
    refusals: int = field(default=0)
    help_links: int = field(default=0)


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


VIZ_CHOICE_FIELD = "vizChoiceId"


def _with_shapes(definition: dict[str, Any], catalog: VizCatalog) -> dict[str, Any]:
    """One tool definition, with the shape field closed over this catalog.

    `vizChoiceId` was a free string, so a shape the model invented arrived as a
    warning in a log and a table on the analyst's screen. An enum makes it
    unsayable instead. It is applied per turn rather than baked into the
    definition because the list of shapes is per instance now.

    Every layer this touches is copied rather than edited. The definitions are
    module-level constants shared by every turn in the process, so patching one
    in place would pin the first caller's catalog onto all of them.
    """
    schema = definition.get("input_schema")
    if not isinstance(schema, dict):
        return dict(definition)
    properties = schema.get("properties")
    if not isinstance(properties, dict) or VIZ_CHOICE_FIELD not in properties:
        return dict(definition)
    shape_field = {"type": "string", "enum": list(catalog.ids), "description": catalog.field_description}
    return {
        **definition,
        "input_schema": {**schema, "properties": {**properties, VIZ_CHOICE_FIELD: shape_field}},
    }


def tool_definitions(catalog: VizCatalog | None = None) -> list[dict[str, Any]]:
    return [_with_shapes(tool.definition, catalog or DEFAULT_CATALOG) for tool in _TOOLS.values()]


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


@dataclass(frozen=True)
class _Target:
    data_source_id: int
    dataset: DatasetOut | None
    info: DataSourceInfo | None


async def _resolve_target(ctx: ToolContext, arguments: dict[str, Any]) -> _Target | Immediate:
    dataset_table = arguments.get("datasetTable")
    explicit_id = arguments.get("dataSourceId")
    if isinstance(dataset_table, str) and dataset_table.strip():
        if explicit_id is not None:
            return Immediate(
                "give either datasetTable (the warehouse catalog) or dataSourceId (another data source), not both",
                is_error=True,
            )
        dataset = _resolve(ctx, arguments)
        if isinstance(dataset, Immediate):
            return dataset
        try:
            warehouse_id = await ctx.data_source_id()
        except ApiError as unresolvable:
            return Immediate(f"the query cannot run on this instance: {unresolvable.message}", is_error=True)
        return _Target(data_source_id=warehouse_id, dataset=dataset, info=None)

    source_id = _positive_id(explicit_id)
    if source_id is None:
        return Immediate(
            "give datasetTable to query the warehouse catalog, or dataSourceId (from list_data_sources) for "
            "another data source",
            is_error=True,
        )
    try:
        existing_warehouse_id: int | None = await ctx.data_source_id()
    except ApiError:
        existing_warehouse_id = None
    if existing_warehouse_id is not None and source_id == existing_warehouse_id:
        return Immediate("this id is the warehouse; give datasetTable to query it, not dataSourceId", is_error=True)
    info = ctx.data_source_info(source_id)
    if info is None or not info.syntax:
        return Immediate(
            "call list_data_sources first so this data source's kind is known before querying it", is_error=True
        )
    if info.view_only:
        return Immediate(
            "this data source is view-only for the analyst's account; ad-hoc queries cannot run against it",
            is_error=True,
        )
    if info.syntax not in ("sql", "json"):
        return Immediate(CANNOT_QUERY_YET, is_error=True)
    return _Target(data_source_id=source_id, dataset=None, info=info)


def _checked_body(ctx: ToolContext, arguments: dict[str, Any], target: _Target) -> str | Immediate:
    if target.dataset is not None:
        if arguments.get("resourceCall") is not None:
            return Immediate("this data source takes sql, not resourceCall", is_error=True)
        return _checked_sql(ctx, arguments, target.dataset)

    assert target.info is not None
    if target.info.syntax == "sql":
        if arguments.get("resourceCall") is not None:
            return Immediate("this data source takes sql, not resourceCall", is_error=True)
        try:
            return validate_generic_sql(text_of(arguments.get("sql"), 50_000))
        except UngroundedSql as refused:
            ctx.refusals += 1
            message = f"the SQL was refused because {refused}. Rewrite it."
            return Immediate(message + (SECOND_REFUSAL if ctx.refusals >= 2 else ""), is_error=True)

    if arguments.get("sql") is not None:
        return Immediate("this data source takes resourceCall, not sql", is_error=True)
    call = arguments.get("resourceCall")
    if not isinstance(call, dict):
        return Immediate("give resourceCall: {resource, params} for this data source", is_error=True)
    resource = text_of(call.get("resource"), 128)
    if not resource:
        return Immediate("resourceCall.resource must name a resource this data source documents", is_error=True)
    registry = target.info.resources
    if registry is None:
        return Immediate(
            "call describe_data_source for this data source before writing a resourceCall; its resource names "
            "are not known yet",
            is_error=True,
        )
    if resource not in registry:
        names = ", ".join(sorted(registry)) or "none"
        message = f"there is no resource called {resource!r} on this data source. Available: {names}"
        return Immediate(message, is_error=True)
    params = call.get("params")
    params = params if isinstance(params, dict) else {}
    declared = registry[resource]
    unexpected = sorted(set(params) - set(declared))
    if unexpected:
        allowed = ", ".join(declared) or "none"
        return Immediate(
            f"resourceCall.params named {unexpected[0]!r}, which this resource does not take. Allowed: {allowed}",
            is_error=True,
        )
    serialized = json.dumps({"resource": resource, "params": params}, separators=(",", ":"))
    if len(serialized) > MAX_RESOURCE_CALL_CHARS:
        message = f"resourceCall is too large (over {MAX_RESOURCE_CALL_CHARS} characters); keep params small"
        return Immediate(message, is_error=True)
    return serialized


async def _run_query(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    target = await _resolve_target(ctx, arguments)
    if isinstance(target, Immediate):
        return target
    body = _checked_body(ctx, arguments, target)
    if isinstance(body, Immediate):
        return body
    return ClientCall(
        call_id=call_id,
        tool="run_query",
        args={
            "dataSourceId": target.data_source_id,
            "sql": body,
            "purpose": text_of(arguments.get("purpose"), 200),
            "vizChoiceId": ctx.catalog.viz_choice(arguments.get("vizChoiceId")),
        },
    )


async def _propose_query(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    target = await _resolve_target(ctx, arguments)
    if isinstance(target, Immediate):
        return target
    body = _checked_body(ctx, arguments, target)
    if isinstance(body, Immediate):
        return body
    default_name = target.dataset.name if target.dataset is not None else f"data source {target.data_source_id}"
    payload: dict[str, Any] = {
        "name": text_of(arguments.get("name"), 255) or default_name,
        "description": text_of(arguments.get("description"), 4_000),
        "sql": body,
        "dataSourceId": target.data_source_id,
        "vizChoiceId": ctx.catalog.viz_choice(arguments.get("vizChoiceId")),
        "vizOptions": {},
    }
    if target.dataset is not None:
        payload["datasetTable"] = target.dataset.id
    draft_id, version = await ctx.save_draft("query", text_of(arguments.get("draftId"), 64) or None, payload)
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


MAX_DASHBOARD_ITEMS = 12
MAX_DASHBOARD_NAME_CHARS = 200
MAX_DASHBOARD_DESCRIPTION_CHARS = 1_000
MAX_ITEM_TITLE_CHARS = 500


async def _dashboard_item(raw: Any, ctx: ToolContext) -> dict[str, Any] | Immediate:
    if not isinstance(raw, dict):
        return Immediate("each item must be an object", is_error=True)
    title = text_of(raw.get("title"), MAX_ITEM_TITLE_CHARS)
    kind = raw.get("kind")
    if kind == "draft":
        draft_id = text_of(raw.get("queryDraftId"), 64)
        if not draft_id or not await ctx.query_draft_exists(draft_id):
            return Immediate(
                "queryDraftId must be a query you proposed earlier in this conversation, with at least one version",
                is_error=True,
            )
        item: dict[str, Any] = {"kind": "draft", "queryDraftId": draft_id}
    elif kind == "existing":
        query_id = _positive_id(raw.get("queryId"))
        visualization_id = _positive_id(raw.get("visualizationId"))
        if query_id is None or visualization_id is None:
            return Immediate(
                "an existing item needs queryId and visualizationId, both from a search result", is_error=True
            )
        item = {"kind": "existing", "queryId": query_id, "visualizationId": visualization_id}
    else:
        return Immediate('each item\'s kind must be "draft" or "existing"', is_error=True)
    if title:
        item["title"] = title
    return item


async def _propose_dashboard(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    name = text_of(arguments.get("name"), MAX_DASHBOARD_NAME_CHARS)
    if not name:
        return Immediate("name must be a short title for the dashboard", is_error=True)
    raw_items = arguments.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        return Immediate("items must list at least one query for the dashboard", is_error=True)
    if len(raw_items) > MAX_DASHBOARD_ITEMS:
        return Immediate(f"items may name at most {MAX_DASHBOARD_ITEMS} queries", is_error=True)
    items: list[dict[str, Any]] = []
    for raw in raw_items:
        item = await _dashboard_item(raw, ctx)
        if isinstance(item, Immediate):
            return item
        items.append(item)
    payload = {
        "name": name,
        "description": text_of(arguments.get("description"), MAX_DASHBOARD_DESCRIPTION_CHARS),
        "items": items,
    }
    draft_id, version = await ctx.save_draft("dashboard", text_of(arguments.get("draftId"), 64) or None, payload)
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
        draft={"draftId": draft_id, "version": version, "kind": "dashboard", "payload": payload},
    )


async def _list_data_sources(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    return ClientCall(call_id=call_id, tool="list_data_sources", args={})


async def _describe_data_source(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    source_id = _positive_id(arguments.get("dataSourceId"))
    if source_id is None:
        return Immediate("dataSourceId must be the id of a data source from list_data_sources", is_error=True)
    return ClientCall(call_id=call_id, tool="describe_data_source", args={"dataSourceId": source_id})


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


def _suggested_pages(wanted: str) -> list[str]:
    index = load_index()
    words = {word for word in re.split(r"[^a-z0-9]+", wanted.lower()) if len(word) >= 3}
    scored = [
        (sum(word in f"{page.id} {page.title}".lower() for word in words), shown_id(page.id))
        for page in (index.pages if index else ())
    ]
    best = max((score for score, _ in scored), default=0)
    return [page_id for score, page_id in scored if best and score == best][:MAX_HELP_SUGGESTIONS]


async def _link_help(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    index = load_index()
    if index is None:
        return Immediate("the documentation is unavailable on this instance; do not link to it", is_error=True)
    if ctx.help_links >= MAX_HELP_LINKS:
        return Immediate(
            f"you already linked {MAX_HELP_LINKS} documentation sections in this turn. Stop linking and answer.",
            is_error=True,
        )
    asked = arguments.get("page")
    if not isinstance(asked, str) or not asked.strip():
        return Immediate("page must name a page from the documentation index; `/` is the introduction", is_error=True)
    wanted = text_of(asked, 200).strip("/")
    page = index.page(wanted)
    if page is None:
        suggestions = _suggested_pages(wanted)
        hint = f" Pages that may fit: {', '.join(suggestions)}." if suggestions else " No page is close to it."
        return Immediate(f"there is no documentation page {wanted!r}.{hint} Use a page from the index.", is_error=True)
    anchor = text_of(arguments.get("section"), 200).lstrip("#") or None
    section = page.section(anchor) if anchor else None
    if anchor and section is None:
        anchors = ", ".join(one.anchor for one in page.sections) or "none"
        return Immediate(
            f"the page {shown_id(page.id)!r} has no section {anchor!r}. Its sections are: {anchors}", is_error=True
        )
    ctx.help_links += 1
    section_title = section.title if section else None
    result = {
        "linked": True,
        "page": page.id,
        "section": anchor,
        "pageTitle": page.title,
        "sectionTitle": section_title,
    }
    card = {
        "callId": call_id,
        "page": page.id,
        "pageTitle": page.title,
        "anchor": anchor,
        "sectionTitle": section_title,
        "reason": text_of(arguments.get("reason"), 200),
    }
    return Immediate(json.dumps(result), is_error=False, frame=("help_link", card))


def _string(description: str) -> dict[str, str]:
    return {"type": "string", "description": description}


def _integer(description: str) -> dict[str, str]:
    return {"type": "integer", "description": description}


_SOURCE_TARGET_PROPERTIES: dict[str, Any] = {
    "datasetTable": _string(
        "The `table` of one catalog entry, copied exactly. Give this for the warehouse; omit it when giving "
        "dataSourceId instead."
    ),
    "dataSourceId": _integer(
        "The id of a data source from list_data_sources, for any source other than the warehouse. Omit when "
        "giving datasetTable instead."
    ),
    "sql": _string(
        "One SELECT statement (a leading WITH is fine). Required with datasetTable, or with a dataSourceId whose "
        'syntax is "sql" (from list_data_sources/describe_data_source).'
    ),
    "resourceCall": {
        "type": "object",
        "description": (
            '{resource, params} for a dataSourceId whose syntax is "json". resource and the allowed params '
            "come from describe_data_source, called earlier in this turn."
        ),
        "properties": {
            "resource": _string("A resource name describe_data_source listed for this data source."),
            "params": {"type": "object", "description": "Only the params that resource documents."},
        },
    },
}

RUN_QUERY = ChatTool(
    name="run_query",
    definition={
        "name": "run_query",
        "description": (
            "Run one read-only query in the analyst's browser under their own permissions, against the warehouse "
            "catalog or another data source. Returns the row count, statistics over the full result and at most "
            "50 sample rows. The analyst sees the full result drawn with vizChoiceId."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                **_SOURCE_TARGET_PROPERTIES,
                "purpose": _string("What this query finds out, in a few words the analyst will see."),
                "vizChoiceId": _string(VIZ_FIELD_DESCRIPTION),
            },
            "required": ["purpose", "vizChoiceId"],
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
            "Offer a query the analyst can save to the platform, against the warehouse catalog or another data "
            "source. Nothing is saved until they click Save. Pass draftId to revise a query you proposed earlier "
            "in this conversation."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "draftId": _string("The draftId of an earlier proposal to revise. Omit for a new one."),
                "name": _string("A short name for the saved query."),
                "description": _string("One sentence on what the query answers."),
                **_SOURCE_TARGET_PROPERTIES,
                "vizChoiceId": _string(VIZ_FIELD_DESCRIPTION),
            },
            "required": ["name", "vizChoiceId"],
        },
    },
    handler=_propose_query,
)

LIST_DATA_SOURCES = ChatTool(
    name="list_data_sources",
    definition={
        "name": "list_data_sources",
        "description": (
            'List the data sources the analyst can query: id, name, type, syntax ("sql" or "json"; chat '
            "cannot query any other syntax yet) and whether the source is view-only for them. Call this before "
            "querying anything outside the warehouse catalog."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    handler=_list_data_sources,
    result_kind="data_sources",
)

DESCRIBE_DATA_SOURCE = ChatTool(
    name="describe_data_source",
    definition={
        "name": "describe_data_source",
        "description": (
            'Learn how to query one data source from list_data_sources: its tables and columns for a "sql" '
            'syntax source, or its named resources and their params for a "json" syntax source. Call this '
            "before run_query or propose_query against that dataSourceId."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"dataSourceId": _integer("The id of a data source from list_data_sources.")},
            "required": ["dataSourceId"],
        },
    },
    handler=_describe_data_source,
    result_kind="data_source_schema",
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

PROPOSE_DASHBOARD = ChatTool(
    name="propose_dashboard",
    definition={
        "name": "propose_dashboard",
        "description": (
            "Offer a dashboard of charts the analyst can save to the platform. Nothing is saved until they click "
            "Save. Each item is a query proposed earlier in this conversation (queryDraftId) or an already-saved "
            "query and one of its visualizations (queryId, visualizationId). Pass draftId to revise a dashboard "
            "you proposed earlier in this conversation."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "draftId": _string("The draftId of an earlier dashboard proposal to revise. Omit for a new one."),
                "name": _string("A short name for the dashboard."),
                "description": _string("One sentence on what the dashboard shows."),
                "items": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_DASHBOARD_ITEMS,
                    "description": "1 to 12 queries to put on the dashboard.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "kind": {"type": "string", "enum": ["draft", "existing"]},
                            "queryDraftId": _string(
                                "For kind draft: the draftId of a query you proposed earlier in this conversation."
                            ),
                            "queryId": _integer(
                                "For kind existing: the id of an already-saved query, from a search result."
                            ),
                            "visualizationId": _integer("For kind existing: one of that query's visualization ids."),
                            "title": _string(
                                "A label for this item on the dashboard. Omit to use the query's own name."
                            ),
                        },
                        "required": ["kind"],
                    },
                },
            },
            "required": ["name", "items"],
        },
    },
    handler=_propose_dashboard,
)

LINK_HELP = ChatTool(
    name="link_help",
    definition={
        "name": "link_help",
        "description": (
            "Show the analyst a link to a section of the Veodyn documentation. Use it for questions about how the "
            "platform works. The analyst sees the link as a card; do not write URLs yourself."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "page": _string("A page from the documentation index, copied exactly. `/` is the introduction."),
                "section": _string("An anchor of that page from the index, without `#`. Omit to link the page."),
                "reason": _string("What the analyst will find there, in a few words."),
            },
            "required": ["page", "reason"],
        },
    },
    handler=_link_help,
)

for _tool in (
    RUN_QUERY,
    PROPOSE_QUERY,
    LIST_DATA_SOURCES,
    DESCRIBE_DATA_SOURCE,
    SEARCH_LIBRARY,
    SHOW_VISUALIZATION,
    OPEN_DASHBOARD,
    PROPOSE_DASHBOARD,
    LINK_HELP,
):
    register_chat_tool(_tool)
