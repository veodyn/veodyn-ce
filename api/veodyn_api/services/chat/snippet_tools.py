import json
from collections.abc import Awaitable, Callable
from typing import Any

from veodyn_api.schemas.ai_chat_proposals import (
    MAX_SNIPPET_BODY_CHARS,
    MAX_SNIPPET_DESCRIPTION_CHARS,
    MAX_SNIPPET_TRIGGER_CHARS,
    ChatSnippetCheckResultIn,
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

SNIPPET_FEATURE = "query_snippets"
CHANGE_FIELDS = ("trigger", "snippet", "description")
LIMITS = {
    "trigger": MAX_SNIPPET_TRIGGER_CHARS,
    "snippet": MAX_SNIPPET_BODY_CHARS,
    "description": MAX_SNIPPET_DESCRIPTION_CHARS,
}
REQUIRED = {"trigger": True, "snippet": True, "description": False}
SAVED_NOTE = "The analyst sees this as a card with a Save button. Nothing is saved until they click it."


def _refused(message: str) -> Immediate:
    return Immediate(message, is_error=True)


def checked_field(name: str, value: Any) -> str | Immediate:
    text = value.strip() if isinstance(value, str) else None
    if text is None or (REQUIRED[name] and not text) or len(text) > LIMITS[name]:
        low = 1 if REQUIRED[name] else 0
        return _refused(f"{name} must be text of {low} to {LIMITS[name]} characters")
    return text


def checked_fields(arguments: dict[str, Any], names: tuple[str, ...]) -> dict[str, str] | Immediate:
    found: dict[str, str] = {}
    for name in names:
        if arguments.get(name) is None:
            continue
        text = checked_field(name, arguments[name])
        if isinstance(text, Immediate):
            return text
        found[name] = text
    return found


async def _propose_snippet(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    fields = checked_fields(arguments, CHANGE_FIELDS)
    if isinstance(fields, Immediate):
        return fields
    for name in ("trigger", "snippet"):
        if name not in fields:
            return _refused(f"{name} is required")
    payload = {
        "trigger": fields["trigger"],
        "snippet": fields["snippet"],
        "description": fields.get("description", ""),
    }
    draft_id, version = await ctx.save_draft("snippet", None, payload)
    return Immediate(
        json.dumps({"draftId": draft_id, "version": version, "saved": False, "note": SAVED_NOTE}),
        is_error=False,
        draft={"draftId": draft_id, "version": version, "kind": "snippet", "payload": payload},
    )


async def _update_snippet(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    snippet_id = positive_id(arguments.get("snippetId"))
    if snippet_id is None:
        return _refused("snippetId must be the id of a saved snippet")
    fields = checked_fields(arguments, CHANGE_FIELDS)
    if isinstance(fields, Immediate):
        return fields
    if not fields:
        return _refused(f"give at least one change: {', '.join(CHANGE_FIELDS)}")
    return ClientCall(call_id=call_id, tool="update_snippet", args={"snippetId": snippet_id, **fields})


async def _delete_snippet(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    snippet_id = positive_id(arguments.get("snippetId"))
    if snippet_id is None:
        return _refused("snippetId must be the id of a saved snippet")
    return ClientCall(call_id=call_id, tool="delete_snippet", args={"snippetId": snippet_id})


def _checked_changes(raw: Any) -> dict[str, str] | Immediate:
    if not isinstance(raw, dict) or not raw:
        return _refused("nothing would change: every value you gave already matches the saved snippet")
    unknown = [name for name in raw if name not in CHANGE_FIELDS]
    if unknown:
        return _refused(f"the browser returned changes to {', '.join(unknown)}, which a snippet does not have")
    return checked_fields(raw, CHANGE_FIELDS)


def _completer(mode: str) -> Callable[[ClientCall, dict[str, Any], ToolContext], Awaitable[Immediate]]:
    async def complete(request: ClientCall, result: dict[str, Any], ctx: ToolContext) -> Immediate:
        parsed = ChatSnippetCheckResultIn.model_validate(result)
        snippet_id = request.args.get("snippetId")
        if parsed.snippet_id != snippet_id:
            return _refused(f"the browser answered for snippet {parsed.snippet_id}, not snippet {snippet_id}")
        if parsed.mode != mode:
            return _refused(f"the browser answered a {parsed.mode} check for a {mode} request")
        if parsed.snapshot is None:
            return _refused("the browser did not return the snippet it read, so there is nothing to compare against")
        snapshot = parsed.snapshot.model_dump(by_alias=True)
        snapshot["description"] = snapshot["description"] or ""
        payload: dict[str, Any] = {"snippetId": snippet_id, "snapshot": snapshot, "changes": {}}
        if mode == "edit":
            changes = _checked_changes(parsed.changes)
            if isinstance(changes, Immediate):
                return changes
            payload["changes"] = changes
        else:
            payload["delete"] = True
        draft_id, version = await ctx.save_draft("snippet_edit", None, payload)
        return Immediate(
            json.dumps(
                {
                    "draftId": draft_id,
                    "version": version,
                    "changed": list(payload["changes"]),
                    "delete": mode == "delete",
                }
            ),
            is_error=False,
            draft={"draftId": draft_id, "version": version, "kind": "snippet_edit", "payload": payload},
        )

    return complete


PROPOSE_SNIPPET = ChatTool(
    name="propose_snippet",
    definition={
        "name": "propose_snippet",
        "description": (
            "Propose a new query snippet: reusable SQL the analyst can insert in the query editor by typing its "
            "trigger. Nothing is saved until the analyst clicks Save on the card."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "trigger": schema_string(
                    f"The word that inserts the snippet, up to {MAX_SNIPPET_TRIGGER_CHARS} characters."
                ),
                "snippet": schema_string(f"The text the trigger inserts, up to {MAX_SNIPPET_BODY_CHARS} characters."),
                "description": schema_string(f"What it is for, up to {MAX_SNIPPET_DESCRIPTION_CHARS} characters."),
            },
            "required": ["trigger", "snippet"],
        },
    },
    handler=_propose_snippet,
    proposal=True,
    requires_feature=SNIPPET_FEATURE,
)

UPDATE_SNIPPET = ChatTool(
    name="update_snippet",
    definition={
        "name": "update_snippet",
        "description": (
            "Propose an edit to a saved query snippet. Give only the fields to change. Nothing changes until the "
            "analyst clicks Apply on the card that shows the before and after."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "snippetId": schema_integer("The id of the saved snippet to edit."),
                "trigger": schema_string("The new trigger."),
                "snippet": schema_string("The new text."),
                "description": schema_string("The new description. Empty to clear it."),
            },
            "required": ["snippetId"],
        },
    },
    handler=_update_snippet,
    proposal=True,
    requires_feature=SNIPPET_FEATURE,
    result_kind="snippet_check",
    complete=_completer("edit"),
)

DELETE_SNIPPET = ChatTool(
    name="delete_snippet",
    definition={
        "name": "delete_snippet",
        "description": (
            "Propose deleting a saved query snippet. Nothing is deleted until the analyst clicks Delete on the card "
            "and confirms a second time."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"snippetId": schema_integer("The id of the saved snippet to delete.")},
            "required": ["snippetId"],
        },
    },
    handler=_delete_snippet,
    proposal=True,
    requires_feature=SNIPPET_FEATURE,
    result_kind="snippet_check",
    complete=_completer("delete"),
)

for _tool in (PROPOSE_SNIPPET, UPDATE_SNIPPET, DELETE_SNIPPET):
    register_chat_tool(_tool)
