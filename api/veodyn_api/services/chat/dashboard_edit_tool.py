import json
from typing import Any

from veodyn_api.schemas.ai_chat_dashboard import (
    GRID_COLUMNS,
    MAX_EDIT_OPERATIONS,
    MAX_ROW_SPAN,
    MAX_TEXT_CHARS,
    ChatDashboardEditResultIn,
)
from veodyn_api.services.chat.dashboard_edit_rules import (
    MAPPING_TYPES,
    MAX_NAME_CHARS,
    OPERATION_KEYS,
    POSITION_KEYS,
    checked_operation,
    checked_tags,
    refused,
)
from veodyn_api.services.chat.tools import (
    ChatTool,
    ClientCall,
    Immediate,
    ToolContext,
    positive_id,
    register_chat_tool,
    schema_integer,
    schema_string,
)


async def _update_dashboard(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    dashboard_id = positive_id(arguments.get("dashboardId"))
    if dashboard_id is None:
        return refused("dashboardId must be the id of a dashboard from a search result or open_dashboard")
    args: dict[str, Any] = {"dashboardId": dashboard_id}
    if arguments.get("name") is not None:
        name = arguments["name"].strip() if isinstance(arguments["name"], str) else ""
        if not name or len(name) > MAX_NAME_CHARS:
            return refused(f"name must be 1 to {MAX_NAME_CHARS} characters")
        args["name"] = name
    if arguments.get("tags") is not None:
        tags = checked_tags(arguments["tags"])
        if isinstance(tags, Immediate):
            return tags
        args["tags"] = tags
    if arguments.get("operations") is not None:
        raw = arguments["operations"]
        if not isinstance(raw, list) or not raw or len(raw) > MAX_EDIT_OPERATIONS:
            return refused(f"operations must list 1 to {MAX_EDIT_OPERATIONS} operations, at most 30 per call")
        operations: list[dict[str, Any]] = []
        targeted: set[int] = set()
        for index, one in enumerate(raw):
            checked = await checked_operation(one, index, ctx)
            if isinstance(checked, Immediate):
                return checked
            widget_id = checked.get("widgetId")
            if widget_id is not None:
                if widget_id in targeted:
                    return refused(
                        f"operation {index + 1}: widgetId {widget_id} is already the target of an earlier "
                        "operation; give each widget one operation per call"
                    )
                targeted.add(widget_id)
            operations.append(checked)
        args["operations"] = operations
    if len(args) == 1:
        return refused("give at least one change: name, tags or operations")
    return ClientCall(call_id=call_id, tool="update_dashboard", args=args)


async def _complete_update_dashboard(request: ClientCall, result: dict[str, Any], ctx: ToolContext) -> Immediate:
    parsed = ChatDashboardEditResultIn.model_validate(result)
    if not parsed.ok:
        return refused(parsed.error or "the browser could not read the dashboard to edit")
    dashboard_id = request.args.get("dashboardId")
    if parsed.dashboard_id != dashboard_id:
        return refused(f"the browser answered for dashboard {parsed.dashboard_id}, not dashboard {dashboard_id}")
    if parsed.problems:
        return refused("the edit was refused: " + "; ".join(parsed.problems))
    if parsed.snapshot is None:
        return refused("the browser did not return the dashboard it read, so there is nothing to compare against")
    if not parsed.operations and parsed.name is None and parsed.tags is None:
        return refused("nothing would change: every value you gave already matches the dashboard")
    payload: dict[str, Any] = {
        "dashboardId": dashboard_id,
        "snapshot": parsed.snapshot.model_dump(by_alias=True),
    }
    if parsed.name is not None:
        payload["name"] = parsed.name
    if parsed.tags is not None:
        payload["tags"] = parsed.tags
    payload["operations"] = [one.model_dump(by_alias=True, exclude_unset=True) for one in parsed.operations]
    draft_id, version = await ctx.save_draft("dashboard_edit", None, payload)
    removes = sum(1 for one in parsed.operations if one.op == "remove")
    return Immediate(
        json.dumps(
            {"draftId": draft_id, "version": version, "operations": len(parsed.operations), "removes": removes}
        ),
        is_error=False,
        draft={"draftId": draft_id, "version": version, "kind": "dashboard_edit", "payload": payload},
    )


POSITION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "description": (
        f"Where the widget sits on the {GRID_COLUMNS}-column grid: col 0 to {GRID_COLUMNS - 1}, row 0 or more, "
        f"sizeX 1 to {GRID_COLUMNS} (col + sizeX at most {GRID_COLUMNS}), sizeY 1 to {MAX_ROW_SPAN}."
    ),
    "properties": {key: {"type": "integer"} for key in POSITION_KEYS},
    "required": list(POSITION_KEYS),
}
MAPPINGS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "description": (
        "For a parameterized query: each of its parameter names mapped to an object with a type. "
        "dashboard-add-new and dashboard-map-to-existing take mapTo, the dashboard parameter name; "
        "widget-level needs nothing more; static-value takes value."
    ),
    "additionalProperties": {
        "type": "object",
        "properties": {
            "type": {"type": "string", "enum": list(MAPPING_TYPES)},
            "mapTo": {"type": "string"},
            "value": {},
            "title": {"type": "string"},
        },
        "required": ["type"],
    },
}

UPDATE_DASHBOARD = ChatTool(
    name="update_dashboard",
    definition={
        "name": "update_dashboard",
        "description": (
            "Propose changes to a saved dashboard as operations; a widget you do not name is untouched, so never "
            "restate the whole dashboard. Call open_dashboard first for widget ids. Nothing changes until the "
            "analyst clicks Apply on the card; removing a widget needs a second click. Give at least one of name, "
            "tags or operations. Operations: add a chart (queryId and visualizationId, or a queryDraftId you "
            "proposed in this conversation), addText (markdown), editText, remove, move (a widget id and its new "
            "position). A new widget without a position is placed in the next free spot."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "dashboardId": schema_integer("The id of the dashboard to edit."),
                "name": schema_string("The new name."),
                "tags": {"type": "array", "items": {"type": "string"}, "description": "The full new tag list."},
                "operations": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_EDIT_OPERATIONS,
                    "items": {
                        "type": "object",
                        "properties": {
                            "op": {"type": "string", "enum": list(OPERATION_KEYS)},
                            "queryId": schema_integer("For add: the id of a saved query."),
                            "visualizationId": schema_integer("For add: one of that query's visualization ids."),
                            "queryDraftId": schema_string("For add: instead of queryId, a query you proposed."),
                            "text": schema_string(f"For addText and editText: markdown, at most {MAX_TEXT_CHARS}."),
                            "widgetId": schema_integer("For editText, remove and move: a widget id."),
                            "position": POSITION_SCHEMA,
                            "parameterMappings": MAPPINGS_SCHEMA,
                        },
                        "required": ["op"],
                    },
                },
            },
            "required": ["dashboardId"],
        },
    },
    handler=_update_dashboard,
    proposal=True,
    result_kind="dashboard_edit",
    complete=_complete_update_dashboard,
)

register_chat_tool(UPDATE_DASHBOARD)
