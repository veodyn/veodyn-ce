from typing import Any

from veodyn_api.services.ai_text import text_of
from veodyn_api.services.chat.tool_types import (
    ChatTool,
    ClientCall,
    Immediate,
    ToolContext,
    positive_id,
    schema_integer,
    schema_string,
)

LIBRARY_KINDS = ("query", "dashboard")
MAX_SEARCH_TAGS = 5
MAX_LIBRARY_SEARCHES = 5


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
    if ctx.library_searches >= MAX_LIBRARY_SEARCHES:
        return Immediate(
            f"you already searched the library {MAX_LIBRARY_SEARCHES} times in this turn. Stop searching and answer "
            "from what you found: give the counts and the tag groups, and offer to narrow it down.",
            is_error=True,
        )
    archived = arguments.get("archived", False)
    if not isinstance(archived, bool):
        return Immediate("archived must be true or false", is_error=True)
    ctx.library_searches += 1
    sort = "recent" if arguments.get("sort") == "recent" else "match"
    return ClientCall(
        call_id=call_id,
        tool="search_library",
        args={"text": text, "kinds": kinds, "tags": tags, "sort": sort, "archived": archived},
    )


async def _show_visualization(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    query_id = positive_id(arguments.get("queryId"))
    if query_id is None:
        return Immediate("queryId must be the id of a query from a search result", is_error=True)
    raw = arguments.get("visualizationId")
    visualization_id = positive_id(raw)
    if raw is not None and visualization_id is None:
        return Immediate("visualizationId must be the id of one of the query's visualizations", is_error=True)
    return ClientCall(
        call_id=call_id,
        tool="show_visualization",
        args={"queryId": query_id, "visualizationId": visualization_id},
    )


async def _open_dashboard(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    dashboard_id = positive_id(arguments.get("dashboardId"))
    if dashboard_id is None:
        return Immediate("dashboardId must be the id of a dashboard from a search result", is_error=True)
    return ClientCall(call_id=call_id, tool="open_dashboard", args={"dashboardId": dashboard_id})


SEARCH_LIBRARY = ChatTool(
    name="search_library",
    definition={
        "name": "search_library",
        "description": (
            "Search the saved queries and dashboards the analyst can see, by text in their names and descriptions "
            "and by tag. Leave text empty and give no tags to browse everything of a kind. Returns at most 50 "
            "dashboards and 10 queries with ids, descriptions, tags and whether a query has a stored result, and "
            "queryCount and dashboardCount: how many matched in all. `more` means more matched than are listed. "
            "A browse also returns tagCounts, the tags in use with how many items carry each: narrow by one of "
            "those tags rather than guessing words. Each item's updatedAt is when it was last edited; a stored "
            "result being refreshed does not change it."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "text": schema_string("Words to look for. Empty or left out to browse."),
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
                "sort": {
                    "type": "string",
                    "enum": ["match", "recent"],
                    "description": "recent lists the most recently edited queries first. match when omitted.",
                },
                "archived": {
                    "type": "boolean",
                    "description": (
                        "true lists archived queries and dashboards instead of live ones, to find one to restore. "
                        "Each item then carries archived: true. false when omitted."
                    ),
                },
            },
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
                "queryId": schema_integer("The id of a query from a search result or a dashboard widget."),
                "visualizationId": schema_integer(
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
            "Read a dashboard's widgets in full: each one's id, kind (chart or text), title, query and visualization, "
            "text, position, parameter mappings and last edit, plus whether the analyst may edit the dashboard. "
            "The analyst gets a link to the dashboard. Use show_visualization to show a widget's chart."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"dashboardId": schema_integer("The id of a dashboard from a search result.")},
            "required": ["dashboardId"],
        },
    },
    handler=_open_dashboard,
    result_kind="dashboard",
)
