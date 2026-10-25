import json
from typing import Any

from veodyn_api.schemas.ai_chat_proposals import ChatKpiCheckResultIn
from veodyn_api.services.ai_text import picked_id
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

DIRECTIONS = ("higher-is-better", "lower-is-better")
CADENCES = ("hourly", "daily", "weekly")
MAX_NAME_CHARS = 255
MAX_DESCRIPTION_CHARS = 4_000
MAX_COLUMN_CHARS = 255
MAX_UNIT_CHARS = 64
MAX_DRAFT_ID_CHARS = 64


def _refused(message: str) -> Immediate:
    return Immediate(message, is_error=True)


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def _text(value: Any, low: int, high: int) -> str | None:
    text = value.strip() if isinstance(value, str) else None
    return text if text is not None and low <= len(text) <= high else None


def coherent_bands(direction: str, at_risk: Any, breached: Any) -> tuple[float | None, float | None]:
    risk, bound = _number(at_risk), _number(breached)
    if risk is None or bound is None:
        return None, None
    ordered = bound <= risk if direction == "higher-is-better" else bound >= risk
    return (risk, bound) if ordered else (None, None)


async def _source(arguments: dict[str, Any], ctx: ToolContext) -> tuple[int | None, str | None] | Immediate:
    named_id, named_draft = arguments.get("sourceQueryId"), arguments.get("queryDraftId")
    if named_id is not None and named_draft is not None:
        return _refused("name either sourceQueryId or queryDraftId, not both")
    if named_draft is not None:
        draft_id = _text(named_draft, 1, MAX_DRAFT_ID_CHARS)
        if draft_id is None or not await ctx.query_draft_exists(draft_id):
            return _refused(
                "queryDraftId must be a query you proposed earlier in this conversation, with at least one version"
            )
        return None, draft_id
    query_id = positive_id(named_id)
    if query_id is None:
        return _refused(
            "give sourceQueryId (a saved query from a search result) or queryDraftId (a query you proposed)"
        )
    return query_id, None


async def _propose_kpi(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    name = _text(arguments.get("name"), 1, MAX_NAME_CHARS)
    if name is None:
        return _refused(f"name must be 1 to {MAX_NAME_CHARS} characters")
    description = _text(arguments.get("description") or "", 0, MAX_DESCRIPTION_CHARS)
    if description is None:
        return _refused(f"description must be at most {MAX_DESCRIPTION_CHARS} characters")
    source = await _source(arguments, ctx)
    if isinstance(source, Immediate):
        return source
    column = _text(arguments.get("valueColumn"), 1, MAX_COLUMN_CHARS)
    if column is None:
        return _refused("valueColumn must name the result column that holds the value")
    unit = _text(arguments.get("unit") or "", 0, MAX_UNIT_CHARS)
    if unit is None:
        return _refused(f"unit must be at most {MAX_UNIT_CHARS} characters")
    target = _number(arguments.get("target"))
    if target is None:
        return _refused("target must be a number; 0 is a target")
    direction, cadence = arguments.get("direction"), arguments.get("cadence")
    if direction not in DIRECTIONS:
        return _refused(f"direction must be one of {', '.join(DIRECTIONS)}")
    if cadence not in CADENCES:
        return _refused(f"cadence must be one of {', '.join(CADENCES)}")
    at_risk, breached = coherent_bands(direction, arguments.get("atRisk"), arguments.get("breached"))
    return ClientCall(
        call_id=call_id,
        tool="propose_kpi",
        args={
            "name": name,
            "description": description,
            "sourceQueryId": source[0],
            "queryDraftId": source[1],
            "valueColumn": column,
            "unit": unit or None,
            "target": target,
            "direction": direction,
            "cadence": cadence,
            "atRisk": at_risk,
            "breached": breached,
        },
    )


async def _complete_propose_kpi(request: ClientCall, result: dict[str, Any], ctx: ToolContext) -> Immediate:
    parsed = ChatKpiCheckResultIn.model_validate(result)
    if not parsed.ok:
        return _refused(parsed.error or "the browser could not read the query this KPI would use")
    wanted_id, wanted_draft = picked_id(request.args.get("sourceQueryId")), request.args.get("queryDraftId")
    if (wanted_id, wanted_draft) != (parsed.source_query_id, parsed.query_draft_id):
        return _refused("the browser answered for a different query than the one the KPI reads")
    column = request.args["valueColumn"]
    if parsed.columns and column not in parsed.columns:
        shown = ", ".join(parsed.columns)
        return _refused(f"the query has no column called {column!r}. It returns: {shown}. Name one of them.")
    payload = {**request.args, "sourceQueryName": parsed.query_name or ""}
    draft_id, version = await ctx.save_draft("kpi", None, payload)
    return Immediate(
        json.dumps(
            {
                "draftId": draft_id,
                "version": version,
                "saved": False,
                "atRisk": payload["atRisk"],
                "breached": payload["breached"],
                "note": "The analyst sees this as a card. Nothing is created until they click Create.",
            }
        ),
        is_error=False,
        draft={"draftId": draft_id, "version": version, "kind": "kpi", "payload": payload},
    )


PROPOSE_KPI = ChatTool(
    name="propose_kpi",
    definition={
        "name": "propose_kpi",
        "description": (
            "Propose a KPI: one number read from the latest row of a saved query, tracked against a target. The "
            "query is a saved query (sourceQueryId) or one you proposed in this conversation (queryDraftId). "
            "Nothing is created until the analyst clicks Create on the card. atRisk and breached are optional "
            "status bands and go together: for higher-is-better, breached is at or below atRisk; for "
            "lower-is-better, at or above. Without them the bands derive from the target."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": schema_string("The KPI's name."),
                "description": schema_string("What it measures."),
                "sourceQueryId": schema_integer("The id of a saved query that returns the value."),
                "queryDraftId": schema_string("Instead of sourceQueryId: a query you proposed in this conversation."),
                "valueColumn": schema_string("The result column that holds the value."),
                "unit": schema_string("The unit shown beside the value, for example %."),
                "target": {"type": "number", "description": "The value the KPI aims for."},
                "direction": {"type": "string", "enum": list(DIRECTIONS)},
                "cadence": {"type": "string", "enum": list(CADENCES), "description": "How often it is evaluated."},
                "atRisk": {"type": "number", "description": "The value at which the KPI is at risk."},
                "breached": {"type": "number", "description": "The value at which the KPI is breached."},
            },
            "required": ["name", "valueColumn", "target", "direction", "cadence"],
        },
    },
    handler=_propose_kpi,
    proposal=True,
    requires_pack=True,
    requires_feature="kpis",
    result_kind="kpi_check",
    complete=_complete_propose_kpi,
)

register_chat_tool(PROPOSE_KPI)
