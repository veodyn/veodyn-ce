import json
from typing import Any

from veodyn_api.services.ai_text import text_of
from veodyn_api.services.chat.saved_query_params import params_problem
from veodyn_api.services.chat.tool_types import (
    ChatTool,
    ClientCall,
    Immediate,
    ToolContext,
    positive_id,
    schema_integer,
    schema_string,
)

MAX_DASHBOARD_ITEMS = 12
MAX_DASHBOARD_NAME_CHARS = 200
MAX_DASHBOARD_DESCRIPTION_CHARS = 1_000
MAX_ITEM_TITLE_CHARS = 500
MAX_ITEM_TEXT_CHARS = 4_000


async def _dashboard_item(raw: Any, ctx: ToolContext) -> dict[str, Any] | Immediate:
    if not isinstance(raw, dict):
        return Immediate("each item must be an object", is_error=True)
    title = text_of(raw.get("title"), MAX_ITEM_TITLE_CHARS)
    kind = raw.get("kind")
    params = raw.get("params")
    if params is not None and kind != "existing":
        return Immediate(
            "params go only on an existing item, a saved query you ran with run_saved_query", is_error=True
        )
    if kind == "text":
        text = raw.get("text")
        text = text.strip() if isinstance(text, str) else ""
        if not text or len(text) > MAX_ITEM_TEXT_CHARS:
            return Immediate(f"a text item needs text of 1 to {MAX_ITEM_TEXT_CHARS} characters", is_error=True)
        return {"kind": "text", "text": text}
    if kind == "draft":
        draft_id = text_of(raw.get("queryDraftId"), 64)
        if not draft_id or not await ctx.query_draft_exists(draft_id):
            return Immediate(
                "queryDraftId must be a query you proposed earlier in this conversation, with at least one version",
                is_error=True,
            )
        item: dict[str, Any] = {"kind": "draft", "queryDraftId": draft_id}
    elif kind == "existing":
        query_id = positive_id(raw.get("queryId"))
        visualization_id = positive_id(raw.get("visualizationId"))
        if query_id is None or visualization_id is None:
            return Immediate(
                "an existing item needs queryId and visualizationId, both from a search result", is_error=True
            )
        item = {"kind": "existing", "queryId": query_id, "visualizationId": visualization_id}
        problem = None if params is None else params_problem(params)
        if problem is not None:
            return Immediate(f"params for query {query_id}: {problem}", is_error=True)
        if params:
            item["parameters"] = params
    else:
        return Immediate('each item\'s kind must be "draft", "existing" or "text"', is_error=True)
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


PROPOSE_DASHBOARD = ChatTool(
    name="propose_dashboard",
    definition={
        "name": "propose_dashboard",
        "description": (
            "Offer a dashboard of charts the analyst can save to the platform. Nothing is saved until they click "
            "Save. Each item is a query proposed earlier in this conversation (queryDraftId) or an already-saved "
            "query and one of its visualizations (queryId, visualizationId), or a text note (kind text, with text). "
            "Give an existing item the params you ran it with in run_saved_query, or its widget shows the query's "
            "saved defaults instead of what you previewed. Pass draftId to revise a dashboard "
            "you proposed earlier in this conversation."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "draftId": schema_string(
                    "The draftId of an earlier dashboard proposal to revise. Omit for a new one."
                ),
                "name": schema_string("A short name for the dashboard."),
                "description": schema_string("One sentence on what the dashboard shows."),
                "items": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_DASHBOARD_ITEMS,
                    "description": "1 to 12 items to put on the dashboard, charts and text notes.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "kind": {"type": "string", "enum": ["draft", "existing", "text"]},
                            "text": schema_string("For kind text: markdown shown in a text widget, at most 4000."),
                            "queryDraftId": schema_string(
                                "For kind draft: the draftId of a query you proposed earlier in this conversation."
                            ),
                            "queryId": schema_integer(
                                "For kind existing: the id of an already-saved query, from a search result."
                            ),
                            "visualizationId": schema_integer(
                                "For kind existing: one of that query's visualization ids."
                            ),
                            "params": {
                                "type": "object",
                                "description": (
                                    "For kind existing: the parameter values by name you gave run_saved_query for "
                                    "this query, kept on the widget. Omit to use the query's saved defaults."
                                ),
                            },
                            "title": schema_string(
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
    proposal=True,
)
