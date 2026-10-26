import json
from typing import Any

from veodyn_api.services.ai_text import text_of
from veodyn_api.services.ai_viz_choice import VIZ_FIELD_DESCRIPTION
from veodyn_api.services.chat.parameter_rules import PARAMETERS_SCHEMA, check_parameters
from veodyn_api.services.chat.query_target import checked_body, resolve_target
from veodyn_api.services.chat.tool_types import (
    ChatTool,
    ClientCall,
    Immediate,
    ToolContext,
    positive_id,
    schema_integer,
    schema_string,
)
from veodyn_api.services.chat.viz_choice_check import missing_viz_choice
from veodyn_api.services.chat.viz_options_check import options_problem


async def _run_query(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    target = await resolve_target(ctx, arguments)
    if isinstance(target, Immediate):
        return target
    body = checked_body(ctx, arguments, target)
    if isinstance(body, Immediate):
        return body
    unchosen = missing_viz_choice(arguments, ctx.catalog)
    if unchosen is not None:
        return Immediate(unchosen, is_error=True)
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
    target = await resolve_target(ctx, arguments)
    if isinstance(target, Immediate):
        return target
    body = checked_body(ctx, arguments, target)
    if isinstance(body, Immediate):
        return body
    unchosen = missing_viz_choice(arguments, ctx.catalog)
    if unchosen is not None:
        return Immediate(unchosen, is_error=True)
    viz_options = arguments.get("vizOptions", {})
    options_refusal = options_problem(viz_options, "vizOptions")
    if options_refusal is not None:
        return Immediate(options_refusal, is_error=True)
    default_name = target.dataset.name if target.dataset is not None else f"data source {target.data_source_id}"
    payload: dict[str, Any] = {
        "name": text_of(arguments.get("name"), 255) or default_name,
        "description": text_of(arguments.get("description"), 4_000),
        "sql": body,
        "dataSourceId": target.data_source_id,
        "vizChoiceId": ctx.catalog.viz_choice(arguments.get("vizChoiceId")),
        "vizOptions": viz_options,
    }
    if target.dataset is not None:
        payload["datasetTable"] = target.dataset.id
    parameters = arguments.get("parameters")
    if parameters is not None:
        problem = check_parameters(body, parameters)
        if problem is not None:
            return Immediate(problem, is_error=True)
        payload["parameters"] = parameters
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


async def _list_data_sources(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    return ClientCall(call_id=call_id, tool="list_data_sources", args={})


async def _describe_data_source(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    source_id = positive_id(arguments.get("dataSourceId"))
    if source_id is None:
        return Immediate("dataSourceId must be the id of a data source from list_data_sources", is_error=True)
    return ClientCall(call_id=call_id, tool="describe_data_source", args={"dataSourceId": source_id})


_SOURCE_TARGET_PROPERTIES: dict[str, Any] = {
    "datasetTable": schema_string(
        "The `table` of one catalog entry, copied exactly. Give this for the warehouse; omit it when giving "
        "dataSourceId instead."
    ),
    "dataSourceId": schema_integer(
        "The id of a data source from list_data_sources, for any source other than the warehouse. Omit when "
        "giving datasetTable instead."
    ),
    "sql": schema_string(
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
            "resource": schema_string("A resource name describe_data_source listed for this data source."),
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
                "purpose": schema_string("What this query finds out, in a few words the analyst will see."),
                "vizChoiceId": schema_string(VIZ_FIELD_DESCRIPTION),
            },
            "required": ["purpose", "vizChoiceId"],
        },
    },
    handler=_run_query,
    mcp_drop=("vizChoiceId", "purpose"),
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
                "draftId": schema_string("The draftId of an earlier proposal to revise. Omit for a new one."),
                "name": schema_string("A short name for the saved query."),
                "description": schema_string("One sentence on what the query answers."),
                **_SOURCE_TARGET_PROPERTIES,
                "vizChoiceId": schema_string(VIZ_FIELD_DESCRIPTION),
                "vizOptions": {
                    "type": "object",
                    "description": (
                        "Options for the chosen visualization type, from describe_visualization_type. "
                        "Omit for the defaults."
                    ),
                },
                "parameters": PARAMETERS_SCHEMA,
            },
            "required": ["name", "vizChoiceId"],
        },
    },
    handler=_propose_query,
    proposal=True,
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
            "properties": {"dataSourceId": schema_integer("The id of a data source from list_data_sources.")},
            "required": ["dataSourceId"],
        },
    },
    handler=_describe_data_source,
    result_kind="data_source_schema",
)
