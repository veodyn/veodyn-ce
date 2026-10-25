import json
from typing import Any

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

MAX_GOAL_CHARS = 1_000
MAX_TITLE_CHARS = 255
MAX_SECTIONS = 20
MAX_INTENT_CHARS = 1_000
MAX_HEADER_CHARS = 500
MAX_MESSAGE_CHARS = 4_000
MAX_DRAFT_ID_CHARS = 64
SAVED_NOTE = "The analyst sees this as a card. Nothing is created until they click it."


def _refused(message: str) -> Immediate:
    return Immediate(message, is_error=True)


def _text(value: Any, low: int, high: int) -> str | None:
    text = value.strip() if isinstance(value, str) else None
    return text if text is not None and low <= len(text) <= high else None


async def _section(index: int, raw: Any, ctx: ToolContext) -> dict[str, Any] | Immediate:
    label = f"section {index + 1}"
    if not isinstance(raw, dict):
        return _refused(f"{label} must be an object with a title and an intent")
    title = _text(raw.get("title"), 1, MAX_TITLE_CHARS)
    if title is None:
        return _refused(f"{label}: title must be 1 to {MAX_TITLE_CHARS} characters")
    intent = _text(raw.get("intent"), 1, MAX_INTENT_CHARS)
    if intent is None:
        return _refused(f"{label}: intent must be 1 to {MAX_INTENT_CHARS} characters, what the section shows")
    named_id, named_draft = raw.get("sourceQueryId"), raw.get("queryDraftId")
    if named_id is not None and named_draft is not None:
        return _refused(f"{label}: name one query, either sourceQueryId or queryDraftId")
    query_id = None
    if named_id is not None:
        query_id = positive_id(named_id)
        if query_id is None:
            return _refused(f"{label}: sourceQueryId must be the id of a saved query from a search result")
    draft_id = None
    if named_draft is not None:
        draft_id = _text(named_draft, 1, MAX_DRAFT_ID_CHARS)
        if draft_id is None or not await ctx.query_draft_exists(draft_id):
            return _refused(
                f"{label}: queryDraftId must be a query you proposed earlier in this conversation, "
                "with at least one version"
            )
    return {
        "title": title,
        "intent": intent,
        "sourceQueryId": query_id,
        "queryDraftId": draft_id,
        "suggested": raw.get("suggested") is True,
    }


def _saved(kind: str, draft_id: str, version: int, payload: dict[str, Any]) -> Immediate:
    return Immediate(
        json.dumps({"draftId": draft_id, "version": version, "saved": False, "note": SAVED_NOTE}),
        is_error=False,
        draft={"draftId": draft_id, "version": version, "kind": kind, "payload": payload},
    )


async def _propose_report(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    goal = _text(arguments.get("goal"), 1, MAX_GOAL_CHARS)
    if goal is None:
        return _refused(f"goal must be 1 to {MAX_GOAL_CHARS} characters, what the report is for")
    title = _text(arguments.get("title") or goal[:MAX_TITLE_CHARS], 1, MAX_TITLE_CHARS)
    if title is None:
        return _refused(f"title must be 1 to {MAX_TITLE_CHARS} characters")
    raw = arguments.get("sections")
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_SECTIONS:
        return _refused(f"sections must list 1 to {MAX_SECTIONS} sections")
    sections: list[dict[str, Any]] = []
    for index, one in enumerate(raw):
        section = await _section(index, one, ctx)
        if isinstance(section, Immediate):
            return section
        sections.append(section)
    payload = {"goal": goal, "title": title, "sections": sections}
    draft_id, version = await ctx.save_draft("report", None, payload)
    return _saved("report", draft_id, version, payload)


async def _propose_message(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    header = _text(arguments.get("header"), 1, MAX_HEADER_CHARS)
    if header is None:
        return _refused(f"header must be 1 to {MAX_HEADER_CHARS} characters, the headline riders read")
    description = _text(arguments.get("description"), 1, MAX_MESSAGE_CHARS)
    if description is None:
        return _refused(f"description must be 1 to {MAX_MESSAGE_CHARS} characters")
    title = _text(arguments.get("title") or header, 1, MAX_TITLE_CHARS)
    if title is None:
        return _refused(f"title must be 1 to {MAX_TITLE_CHARS} characters")
    payload = {"title": title, "header": header, "description": description}
    draft_id, version = await ctx.save_draft("message", None, payload)
    return _saved("message", draft_id, version, payload)


SECTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "title": schema_string("The section's heading."),
        "intent": schema_string("What the section shows or argues, in a sentence."),
        "sourceQueryId": schema_integer("The id of a saved query that backs the section."),
        "queryDraftId": schema_string("Instead of sourceQueryId: a query you proposed in this conversation."),
        "suggested": {"type": "boolean", "description": "true for a section you added beyond what was asked."},
    },
    "required": ["title", "intent"],
}

PROPOSE_REPORT = ChatTool(
    name="propose_report",
    definition={
        "name": "propose_report",
        "description": (
            "Propose the outline of a report. Each section has a title, an intent and optionally a query behind "
            "it, either saved (sourceQueryId) or proposed by you in this conversation (queryDraftId); a section "
            "with neither is narrative only. Nothing is created until the analyst clicks Create on the card, and "
            "the report is created as a draft; publishing is a separate step."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "goal": schema_string("What the report is for."),
                "title": schema_string("The report's title. Defaults to the goal."),
                "sections": {"type": "array", "minItems": 1, "maxItems": MAX_SECTIONS, "items": SECTION_SCHEMA},
            },
            "required": ["goal", "sections"],
        },
    },
    handler=_propose_report,
    proposal=True,
    requires_pack=True,
    requires_feature="reports",
)

PROPOSE_MESSAGE = ChatTool(
    name="propose_message",
    definition={
        "name": "propose_message",
        "description": (
            "Propose a rider-facing message: a headline and a sentence or two. Nothing is created until the "
            "analyst clicks Create on the card, which opens the message form prefilled."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": schema_string("An internal title. Defaults to the header."),
                "header": schema_string("The headline riders read."),
                "description": schema_string("The sentence or two riders read under the headline."),
            },
            "required": ["header", "description"],
        },
    },
    handler=_propose_message,
    proposal=True,
    requires_pack=True,
    requires_feature="messages",
)

for _tool in (PROPOSE_REPORT, PROPOSE_MESSAGE):
    register_chat_tool(_tool)
