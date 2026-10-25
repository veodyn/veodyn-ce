from typing import Any

from veodyn_api.services.ai_text import picked_id, text_of
from veodyn_api.services.chat.saved_query_params import params_problem
from veodyn_api.services.chat.tools import ChatTool, ClientCall, Immediate, ToolContext, register_chat_tool


def _checked_params(raw: Any) -> dict[str, Any] | Immediate:
    if raw is None:
        return {}
    problem = params_problem(raw)
    return raw if problem is None else Immediate(problem, is_error=True)


async def _run_saved_query(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    query_id = picked_id(arguments.get("queryId"))
    if query_id is None or query_id <= 0:
        return Immediate("queryId must be the id of a saved query from the ready-made list or a search", is_error=True)
    raw_visualization = arguments.get("visualizationId")
    visualization_id = picked_id(raw_visualization)
    if raw_visualization is not None and (visualization_id is None or visualization_id <= 0):
        return Immediate("visualizationId must be the id of one of the query's visualizations", is_error=True)
    params = _checked_params(arguments.get("params"))
    if isinstance(params, Immediate):
        return params
    return ClientCall(
        call_id=call_id,
        tool="run_saved_query",
        args={
            "queryId": query_id,
            "parameters": params,
            "visualizationId": visualization_id,
            "purpose": text_of(arguments.get("purpose"), 200),
        },
    )


RUN_SAVED_QUERY = ChatTool(
    name="run_saved_query",
    definition={
        "name": "run_saved_query",
        "description": (
            "Run a saved query again with fresh data under the analyst's own permissions, and draw it. The "
            "query's saved parameter defaults are used for any parameter you do not give. Give "
            "visualizationId to draw the saved visualization with its own options. A parameter value the "
            "analyst may not use comes back as a refusal; read it and choose another."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "queryId": {"type": "integer", "description": "The id of a saved query."},
                "params": {
                    "type": "object",
                    "description": (
                        "Parameter values by name: a string, a number, a list of strings, or an object with "
                        "string start and end for a date range. Omit to use the saved defaults."
                    ),
                },
                "visualizationId": {
                    "type": "integer",
                    "description": "The id of one of the query's visualizations. Omit for its main chart.",
                },
                "purpose": {"type": "string", "description": "In a few words, why this query is being run."},
            },
            "required": ["queryId", "purpose"],
        },
    },
    handler=_run_saved_query,
    mcp_drop=("vizChoiceId", "purpose"),
    result_kind="query_result",
)

register_chat_tool(RUN_SAVED_QUERY)
