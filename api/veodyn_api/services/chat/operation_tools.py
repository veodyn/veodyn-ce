from typing import Any

from veodyn_api.schemas.ai_chat_operation import DOWNLOAD_FORMATS, REFRESH_SECONDS
from veodyn_api.services.chat.operation_check import (
    Expectation,
    completer,
    expect_archive,
    expect_dashboard_share,
    expect_favorite,
    expect_fork,
    expect_visualization_share,
)
from veodyn_api.services.chat.operation_handlers import (
    EXPIRES_AT_NOTE,
    FAVORITE_KINDS,
    SHARE_ACTIONS,
    archive_handler,
    download_result,
    fork_query,
    set_favorite,
    share_dashboard,
    share_visualization,
)
from veodyn_api.services.chat.tools import ChatTool, register_chat_tool, schema_integer, schema_string


def _operation_tool(
    name: str, description: str, properties: dict[str, Any], required: list[str], handler: Any, expect: Expectation
) -> ChatTool:
    return ChatTool(
        name=name,
        definition={
            "name": name,
            "description": description,
            "input_schema": {"type": "object", "properties": properties, "required": required},
        },
        handler=handler,
        proposal=True,
        result_kind="operation_check",
        complete=completer(expect),
    )


def _restore_property(what: str) -> dict[str, Any]:
    return {"type": "boolean", "description": f"true to restore an archived {what}. false or omitted to archive it."}


def _action_property(what: str) -> dict[str, Any]:
    return {
        "type": "string",
        "enum": list(SHARE_ACTIONS),
        "description": f"create or revoke the public link of {what}.",
    }


FORK_QUERY = _operation_tool(
    "fork_query",
    "Propose a copy of a saved query that the analyst can then edit. The analyst clicks Apply on the card; nothing "
    "is copied before that.",
    {"queryId": schema_integer("The id of the saved query to copy.")},
    ["queryId"],
    fork_query,
    expect_fork,
)

ARCHIVE_QUERY = _operation_tool(
    "archive_query",
    "Propose archiving a saved query, or restoring an archived one. Archiving also clears its schedule, alerts and "
    "dashboard widgets, so the card asks the analyst to confirm a second time. Only the owner or an admin may "
    "archive. Find an archived query with search_library and archived: true.",
    {"queryId": schema_integer("The id of the query."), "restore": _restore_property("query")},
    ["queryId"],
    archive_handler("archive_query", "queryId", "a saved query"),
    expect_archive("query", "queryId"),
)

ARCHIVE_DASHBOARD = _operation_tool(
    "archive_dashboard",
    "Propose archiving a dashboard, or restoring an archived one. Archiving revokes its public link and restoring "
    "does not bring the link back, so the card asks the analyst to confirm a second time. Only the owner or an "
    "admin may archive. Find an archived dashboard with search_library and archived: true.",
    {"dashboardId": schema_integer("The id of the dashboard."), "restore": _restore_property("dashboard")},
    ["dashboardId"],
    archive_handler("archive_dashboard", "dashboardId", "a saved dashboard"),
    expect_archive("dashboard", "dashboardId"),
)

SET_FAVORITE = _operation_tool(
    "set_favorite",
    "Propose adding a saved query or dashboard to the analyst's favorites, or removing it. The card applies it in "
    "one click.",
    {
        "kind": {"type": "string", "enum": list(FAVORITE_KINDS), "description": "query or dashboard."},
        "id": schema_integer("The id of the query or dashboard."),
        "favorite": {"type": "boolean", "description": "true to favorite it, false to remove it from favorites."},
    },
    ["kind", "id", "favorite"],
    set_favorite,
    expect_favorite,
)

SHARE_DASHBOARD = _operation_tool(
    "share_dashboard",
    "Propose creating or revoking a dashboard's public link. Only the owner or an admin who may publish can. "
    "Revoking asks the analyst to confirm a second time.",
    {
        "dashboardId": schema_integer("The id of the dashboard."),
        "action": _action_property("the dashboard"),
        "expiresAt": schema_string(f"When a new link stops working. {EXPIRES_AT_NOTE} Omit for no expiry."),
    },
    ["dashboardId", "action"],
    share_dashboard,
    expect_dashboard_share,
)

SHARE_VISUALIZATION = _operation_tool(
    "share_visualization",
    "Propose creating or revoking the public link and embed of one chart. Only queries without text parameters "
    "can be published, and only the owner or an admin who may publish can. Revoking asks the analyst to confirm a "
    "second time.",
    {
        "queryId": schema_integer("The id of the query that owns the chart."),
        "visualizationId": schema_integer("The id of the visualization."),
        "action": _action_property("the chart"),
        "expiresAt": schema_string(f"When a new link stops working. {EXPIRES_AT_NOTE} Omit for no expiry."),
        "refreshSeconds": {
            "type": "integer",
            "enum": list(REFRESH_SECONDS),
            "description": "How often an embedded chart reloads, in seconds. 0 never reloads.",
        },
    },
    ["queryId", "visualizationId", "action"],
    share_visualization,
    expect_visualization_share,
)

DOWNLOAD_RESULT = ChatTool(
    name="download_result",
    definition={
        "name": "download_result",
        "description": (
            "Hand the analyst CSV or XLSX download links for the stored result of a saved query. The links are "
            "theirs to click: no data comes back to you. Refused when their account may not export data or the "
            "query has no stored result."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "queryId": schema_integer("The id of the saved query."),
                "format": {"type": "string", "enum": list(DOWNLOAD_FORMATS), "description": "csv or xlsx."},
            },
            "required": ["queryId", "format"],
        },
    },
    handler=download_result,
    result_kind="download",
)

for _tool in (
    FORK_QUERY,
    ARCHIVE_QUERY,
    ARCHIVE_DASHBOARD,
    SET_FAVORITE,
    SHARE_DASHBOARD,
    SHARE_VISUALIZATION,
    DOWNLOAD_RESULT,
):
    register_chat_tool(_tool)
