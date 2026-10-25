import json
from typing import Any

from veodyn_api.errors import ApiError
from veodyn_api.schemas.ai import AiDatasetIn
from veodyn_api.services.ai_sql import QUERYABLE_TABLE_RE, UngroundedSql, validate_sql
from veodyn_api.services.chat.parameter_rules import PARAMETERS_SCHEMA, check_parameter_names, check_parameters
from veodyn_api.services.chat.query_change_rules import CHANGE_FIELDS, SCHEDULE_INTERVALS, check_changes
from veodyn_api.services.chat.tools import (
    MAX_NAMED_TABLES,
    SECOND_REFUSAL,
    ChatTool,
    ClientCall,
    Immediate,
    ToolContext,
    checked_body,
    positive_id,
    register_chat_tool,
    resolve_target,
    schema_integer,
    schema_string,
)

SNAPSHOT_FIELDS = (
    "id",
    "name",
    "description",
    "sql",
    "dataSourceId",
    "parameters",
    "tags",
    "schedule",
    "isDraft",
    "updatedAt",
)


def _refused(message: str) -> Immediate:
    return Immediate(message, is_error=True)


async def _open_query(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    query_id = positive_id(arguments.get("queryId"))
    if query_id is None:
        return _refused("queryId must be the id of a saved query from a search result or a dashboard widget")
    return ClientCall(call_id=call_id, tool="open_query", args={"queryId": query_id})


async def _update_query(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    query_id = positive_id(arguments.get("queryId"))
    if query_id is None:
        return _refused("queryId must be the id of a saved query from a search result or open_query")
    changes = arguments.get("changes")
    if not isinstance(changes, dict) or not changes:
        return _refused(f"changes must name at least one field to change: {', '.join(CHANGE_FIELDS)}")
    problem = check_changes(changes)
    if problem is None and "sql" in changes and "parameters" in changes:
        problem = check_parameters(changes["sql"], changes["parameters"])
    if problem is not None:
        return _refused(problem)
    return ClientCall(
        call_id=call_id,
        tool="update_query",
        args={"queryId": query_id, "changes": changes, "format": arguments.get("format") is True},
    )


async def _sql_problem(ctx: ToolContext, sql: str, data_source_id: int) -> Immediate | None:
    try:
        warehouse: int | None = await ctx.data_source_id()
    except ApiError:
        warehouse = None
    if warehouse is not None and data_source_id == warehouse:
        return _warehouse_sql_problem(ctx, sql)
    target = await resolve_target(ctx, {"dataSourceId": data_source_id})
    if isinstance(target, Immediate):
        return target
    assert target.info is not None
    if target.info.syntax == "json":
        try:
            call = json.loads(sql)
        except ValueError:
            call = None
        if not isinstance(call, dict):
            return _refused('this data source takes a JSON object as sql: {"resource": ..., "params": {...}}')
        body = checked_body(ctx, {"resourceCall": call}, target)
    else:
        body = checked_body(ctx, {"sql": sql}, target)
    return body if isinstance(body, Immediate) else None


def _warehouse_sql_problem(ctx: ToolContext, sql: str) -> Immediate | None:
    queryable = [one for one in ctx.datasets if QUERYABLE_TABLE_RE.match(one.id)]
    if not queryable:
        return _refused(
            "this query is on the warehouse, whose catalog is not available to you here, so its SQL cannot be "
            "checked. Leave the SQL and data source alone."
        )
    reasons: list[str] = []
    for dataset in queryable:
        try:
            validate_sql(sql, AiDatasetIn(table=dataset.id, columns=[]))
            return None
        except UngroundedSql as refused:
            if str(refused) not in reasons:
                reasons.append(str(refused))
    ctx.refusals += 1
    if len(reasons) == 1:
        detail = f"the SQL was refused because {reasons[0]}. Rewrite it."
    else:
        names = ", ".join(one.id for one in queryable[:MAX_NAMED_TABLES])
        detail = f"the SQL was refused: it must read exactly one table of the warehouse catalog ({names}). Rewrite it."
    return _refused(detail + (SECOND_REFUSAL if ctx.refusals >= 2 else ""))


def _snapshot(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    snapshot = {key: raw.get(key) for key in SNAPSHOT_FIELDS}
    if not isinstance(snapshot["sql"], str) or positive_id(snapshot["dataSourceId"]) is None:
        return None
    snapshot["parameters"] = snapshot["parameters"] if isinstance(snapshot["parameters"], list) else []
    snapshot["tags"] = snapshot["tags"] if isinstance(snapshot["tags"], list) else []
    return snapshot


async def _complete_update_query(request: ClientCall, result: dict[str, Any], ctx: ToolContext) -> Immediate:
    query_id = request.args.get("queryId")
    if result.get("queryId") != query_id:
        return _refused(f"the browser answered for query {result.get('queryId')}, not query {query_id}")
    snapshot = _snapshot(result.get("snapshot"))
    if snapshot is None:
        return _refused("the browser did not return the query it read, so there is nothing to compare against")
    changes = result.get("changes")
    if not isinstance(changes, dict) or not changes:
        return _refused("nothing would change: every value you gave already matches the saved query")
    problem = check_changes(changes)
    if problem is not None:
        return _refused(problem)
    resolved = {**snapshot, **changes}
    if "sql" in changes or "dataSourceId" in changes:
        refusal = await _sql_problem(ctx, resolved["sql"], resolved["dataSourceId"])
        if refusal is not None:
            return refusal
    if "sql" in changes or "parameters" in changes:
        check = check_parameters if "parameters" in changes else check_parameter_names
        problem = check(resolved["sql"], resolved["parameters"])
        if problem is not None:
            return _refused(problem)
    payload = {"queryId": query_id, "snapshot": snapshot, "changes": changes}
    draft_id, version = await ctx.save_draft("query_edit", None, payload)
    return Immediate(
        json.dumps({"draftId": draft_id, "version": version, "changed": list(changes)}),
        is_error=False,
        draft={"draftId": draft_id, "version": version, "kind": "query_edit", "payload": payload},
    )


OPEN_QUERY = ChatTool(
    name="open_query",
    definition={
        "name": "open_query",
        "description": (
            "Read one saved query in full: its SQL, data source, parameter definitions, tags, schedule, whether it "
            "is a draft, its visualizations, when it was last edited (updatedAt) and canEdit, whether the analyst "
            "may edit it. Use it before proposing an edit, and to answer what a saved query does. It never runs "
            "the query."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"queryId": schema_integer("The id of a saved query from a search result or a widget.")},
            "required": ["queryId"],
        },
    },
    handler=_open_query,
    result_kind="query_detail",
)

UPDATE_QUERY = ChatTool(
    name="update_query",
    definition={
        "name": "update_query",
        "description": (
            "Propose an edit to a saved query. Nothing changes until the analyst clicks Apply on the card that "
            "shows the before and after. Give only the fields to change inside changes. Call open_query first so "
            "you edit from the current values. Parameters are the full new list, and every `{{ name }}` in the SQL "
            "needs a definition. Tags are the full new list. A schedule needs all of its intent in one object; "
            "null clears it. A saved query's data source can be changed with dataSourceId when the SQL suits the "
            "new source. The result says which fields would change."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "queryId": schema_integer("The id of the saved query to edit."),
                "changes": {
                    "type": "object",
                    "description": "Only the fields to change.",
                    "properties": {
                        "sql": schema_string("The full new SQL (or JSON resource call) of the query."),
                        "name": schema_string("The new name."),
                        "description": schema_string("The new description. Empty to clear it."),
                        "dataSourceId": schema_integer("The id of a data source from list_data_sources."),
                        "tags": {"type": "array", "items": {"type": "string"}, "description": "The full tag list."},
                        "parameters": PARAMETERS_SCHEMA,
                        "schedule": {
                            "type": ["object", "null"],
                            "description": (
                                "When the query refreshes by itself, or null for never. interval is in seconds: "
                                f"{', '.join(str(one) for one in SCHEDULE_INTERVALS)} (0 is never). time (HH:MM) "
                                "only for an interval of a day or more, dayOfWeek only for 604800, until (a date) "
                                "optional."
                            ),
                            "properties": {
                                "interval": {"type": "integer", "enum": list(SCHEDULE_INTERVALS)},
                                "time": {"type": ["string", "null"]},
                                "dayOfWeek": {"type": ["string", "null"]},
                                "until": {"type": ["string", "null"]},
                            },
                            "required": ["interval"],
                        },
                        "isDraft": {"type": "boolean", "description": "true to unpublish, false to publish."},
                    },
                },
                "format": {
                    "type": "boolean",
                    "description": "true to have the editor's SQL formatter applied to sql. Only when asked to.",
                },
            },
            "required": ["queryId", "changes"],
        },
    },
    handler=_update_query,
    proposal=True,
    result_kind="query_edit",
    complete=_complete_update_query,
)

register_chat_tool(OPEN_QUERY)
register_chat_tool(UPDATE_QUERY)
