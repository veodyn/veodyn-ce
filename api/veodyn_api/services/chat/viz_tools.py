import json
from typing import Any

from veodyn_api.schemas.ai_chat_viz import ChatVizCheckResultIn
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
from veodyn_api.services.chat.viz_options_check import MAX_OPTIONS_CHARS, options_problem

MAX_TYPE_CHARS = 64
MAX_NAME_CHARS = 255
MAX_OPERATIONS = 50
MODE_OF_TOOL = {"propose_visualization": "new", "update_visualization": "edit", "delete_visualization": "delete"}

SET_SCHEMA: dict[str, Any] = {
    "type": "array",
    "maxItems": MAX_OPERATIONS,
    "description": (
        "Options to set, each a dot path from the top-level option (for example yAxis.0.rangeMin or "
        "columnMapping.speed) and its new value."
    ),
    "items": {
        "type": "object",
        "properties": {"path": {"type": "string"}, "value": {}},
        "required": ["path", "value"],
    },
}
UNSET_SCHEMA: dict[str, Any] = {
    "type": "array",
    "maxItems": MAX_OPERATIONS,
    "items": {"type": "string"},
    "description": "Option dot paths to clear back to their default.",
}


def _refused(message: str) -> Immediate:
    return Immediate(message, is_error=True)


def _type_name(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and 0 < len(value.strip()) <= MAX_TYPE_CHARS else None


def _name(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and 0 < len(value.strip()) <= MAX_NAME_CHARS else None


def _query_id(arguments: dict[str, Any]) -> int | None:
    return positive_id(arguments.get("queryId"))


async def _describe_visualization_type(
    call_id: str, arguments: dict[str, Any], ctx: ToolContext
) -> ClientCall | Immediate:
    type_name = _type_name(arguments.get("type"))
    if type_name is None:
        return _refused(f"type must be a visualization type name of at most {MAX_TYPE_CHARS} characters")
    return ClientCall(call_id=call_id, tool="describe_visualization_type", args={"type": type_name})


async def _propose_visualization(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    query_id = _query_id(arguments)
    if query_id is None:
        return _refused("queryId must be the id of a saved query")
    type_name = _type_name(arguments.get("type"))
    if type_name is None:
        return _refused("type must be a visualization type name from describe_visualization_type")
    name = _name(arguments.get("name"))
    if name is None:
        return _refused(f"name must be 1 to {MAX_NAME_CHARS} characters")
    options = arguments.get("options")
    problem = options_problem(options, "options")
    if problem is not None:
        return _refused(problem)
    return ClientCall(
        call_id=call_id,
        tool="propose_visualization",
        args={"queryId": query_id, "type": type_name, "name": name, "options": options},
    )


def _operations(arguments: dict[str, Any]) -> tuple[dict[str, Any], str | None]:
    found: dict[str, Any] = {}
    raw_set = arguments.get("set")
    if raw_set is not None:
        valid = (
            isinstance(raw_set, list)
            and len(raw_set) <= MAX_OPERATIONS
            and all(
                isinstance(one, dict) and isinstance(one.get("path"), str) and one["path"].strip() and "value" in one
                for one in raw_set
            )
        )
        if not valid:
            return {}, f"set must be a list of at most {MAX_OPERATIONS} items, each with a path and a value"
        if len(json.dumps(raw_set)) > MAX_OPTIONS_CHARS:
            return {}, f"set is over {MAX_OPTIONS_CHARS} characters"
        found["set"] = [{"path": one["path"].strip(), "value": one["value"]} for one in raw_set]
    raw_unset = arguments.get("unset")
    if raw_unset is not None:
        valid = (
            isinstance(raw_unset, list)
            and len(raw_unset) <= MAX_OPERATIONS
            and all(isinstance(one, str) and one.strip() for one in raw_unset)
        )
        if not valid:
            return {}, f"unset must be a list of at most {MAX_OPERATIONS} option paths"
        found["unset"] = [one.strip() for one in raw_unset]
    return found, None


async def _update_visualization(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    query_id = _query_id(arguments)
    if query_id is None:
        return _refused("queryId must be the id of the query that owns the visualization")
    visualization_id = positive_id(arguments.get("visualizationId"))
    if visualization_id is None:
        return _refused("visualizationId must be the id of one of the query's visualizations from open_query")
    args: dict[str, Any] = {"queryId": query_id, "visualizationId": visualization_id}
    if arguments.get("type") is not None:
        type_name = _type_name(arguments.get("type"))
        if type_name is None:
            return _refused("type must be a visualization type name from describe_visualization_type")
        args["type"] = type_name
    if arguments.get("name") is not None:
        name = _name(arguments.get("name"))
        if name is None:
            return _refused(f"name must be 1 to {MAX_NAME_CHARS} characters")
        args["name"] = name
    operations, problem = _operations(arguments)
    if problem is not None:
        return _refused(problem)
    args.update(operations)
    if len(args) == 2:
        return _refused("give at least one change: type, name, set or unset")
    return ClientCall(call_id=call_id, tool="update_visualization", args=args)


async def _delete_visualization(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    query_id = _query_id(arguments)
    if query_id is None:
        return _refused("queryId must be the id of the query that owns the visualization")
    visualization_id = positive_id(arguments.get("visualizationId"))
    if visualization_id is None:
        return _refused("visualizationId must be the id of one of the query's visualizations from open_query")
    return ClientCall(
        call_id=call_id, tool="delete_visualization", args={"queryId": query_id, "visualizationId": visualization_id}
    )


async def _complete_visualization(request: ClientCall, result: dict[str, Any], ctx: ToolContext) -> Immediate:
    parsed = ChatVizCheckResultIn.model_validate(result)
    mode = MODE_OF_TOOL[request.tool]
    if parsed.mode != mode:
        return _refused(f"the browser answered with mode {parsed.mode}, not {mode}")
    if parsed.query_id != request.args.get("queryId"):
        return _refused(f"the browser answered for query {parsed.query_id}, not query {request.args.get('queryId')}")
    if mode != "new" and parsed.visualization_id != request.args.get("visualizationId"):
        return _refused(
            f"the browser answered for visualization {parsed.visualization_id}, "
            f"not visualization {request.args.get('visualizationId')}"
        )
    if parsed.problems:
        return _refused("the visualization was refused: " + "; ".join(parsed.problems))
    if mode != "new" and parsed.snapshot is None:
        return _refused("the browser did not return the visualization it read, so there is nothing to compare against")
    if mode != "delete" and parsed.next is None:
        return _refused("the browser did not return the resulting visualization")
    payload: dict[str, Any] = {"mode": mode, "queryId": parsed.query_id}
    if mode != "new":
        payload["visualizationId"] = parsed.visualization_id
    if parsed.snapshot is not None and mode != "new":
        payload["snapshot"] = parsed.snapshot.model_dump(by_alias=True)
    if parsed.next is not None and mode != "delete":
        payload["next"] = parsed.next.model_dump(by_alias=True)
    draft_id, version = await ctx.save_draft("visualization", None, payload)
    return Immediate(
        json.dumps({"draftId": draft_id, "version": version}),
        is_error=False,
        draft={"draftId": draft_id, "version": version, "kind": "visualization", "payload": payload},
    )


DESCRIBE_VISUALIZATION_TYPE = ChatTool(
    name="describe_visualization_type",
    definition={
        "name": "describe_visualization_type",
        "description": (
            "Read every option one visualization type accepts: its key, shape, allowed values and what it does, "
            "and which options name a result column. Call it before setting options on that type."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"type": schema_string("A visualization type, for example CHART, TABLE or COUNTER.")},
            "required": ["type"],
        },
    },
    handler=_describe_visualization_type,
    result_kind="visualization_type",
)

PROPOSE_VISUALIZATION = ChatTool(
    name="propose_visualization",
    definition={
        "name": "propose_visualization",
        "description": (
            "Offer a new visualization on a saved query. Nothing is saved until the analyst clicks Apply on the "
            "card. Options that name a column are checked against the query's stored result before the card shows, "
            "so run the query first when it has no stored result."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "queryId": schema_integer("The id of the saved query to draw."),
                "type": schema_string("A visualization type from describe_visualization_type."),
                "name": schema_string("A short name for the visualization."),
                "options": {"type": "object", "description": "The type's options. Use {} for the defaults."},
            },
            "required": ["queryId", "type", "name", "options"],
        },
    },
    handler=_propose_visualization,
    proposal=True,
    result_kind="visualization_check",
    complete=_complete_visualization,
)

UPDATE_VISUALIZATION = ChatTool(
    name="update_visualization",
    definition={
        "name": "update_visualization",
        "description": (
            "Propose a change to one visualization of a saved query: its type, name, or options as set and unset "
            "operations. Nothing changes until the analyst clicks Apply on the card showing the difference. Give "
            "at least one change. A type change starts from that type's defaults plus the set operations."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "queryId": schema_integer("The id of the query that owns the visualization."),
                "visualizationId": schema_integer("The id of a visualization from open_query."),
                "type": schema_string("The new visualization type."),
                "name": schema_string("The new name."),
                "set": SET_SCHEMA,
                "unset": UNSET_SCHEMA,
            },
            "required": ["queryId", "visualizationId"],
        },
    },
    handler=_update_visualization,
    proposal=True,
    result_kind="visualization_check",
    complete=_complete_visualization,
)

DELETE_VISUALIZATION = ChatTool(
    name="delete_visualization",
    definition={
        "name": "delete_visualization",
        "description": (
            "Propose deleting one visualization of a saved query. The analyst confirms with a second click, and "
            "its dashboard widgets go with it. A query's table visualization cannot be deleted."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "queryId": schema_integer("The id of the query that owns the visualization."),
                "visualizationId": schema_integer("The id of a visualization from open_query."),
            },
            "required": ["queryId", "visualizationId"],
        },
    },
    handler=_delete_visualization,
    proposal=True,
    result_kind="visualization_check",
    complete=_complete_visualization,
)

register_chat_tool(DESCRIBE_VISUALIZATION_TYPE)
register_chat_tool(PROPOSE_VISUALIZATION)
register_chat_tool(UPDATE_VISUALIZATION)
register_chat_tool(DELETE_VISUALIZATION)
