from typing import Any

from tests.query_edit_stubs import call, ctx
from tests.test_chat_tools import Drafts
from veodyn_api.services.chat.tools import ClientCall, Immediate, completer_for, prepare_call

POSITION = {"col": 0, "row": 0, "sizeX": 3, "sizeY": 8}
WIDGET_POSITION = {"col": 3, "row": 0, "sizeX": 3, "sizeY": 8}
STAMP = "2026-10-24T09:01:00+00:00"
SNAPSHOT = {
    "name": "Ops",
    "tags": ["daily"],
    "version": 4,
    "updatedAt": "2026-10-24T09:00:00+00:00",
    "widgets": [{"widgetId": 31, "kind": "text", "title": "Notes", "position": WIDGET_POSITION, "updatedAt": STAMP}],
}
ADD = {"op": "add", "queryId": 5, "visualizationId": 9}
RESOLVED_ADD = {"op": "add", "queryId": 5, "visualizationId": 9, "position": POSITION, "title": "Trips"}
RESOLVED_DRAFT = {"op": "add", "queryDraftId": "d-1", "position": POSITION, "title": "Speeds"}
RESOLVED_TEXT = {"op": "addText", "text": "Hi", "position": POSITION}
RESOLVED_EDIT = {
    "op": "editText",
    "widgetId": 31,
    "text": "Bye",
    "position": WIDGET_POSITION,
    "title": "Notes",
    "updatedAt": STAMP,
}
RESOLVED_MOVE = {**RESOLVED_EDIT, "op": "move"}
RESOLVED_REMOVE = {
    "op": "remove",
    "widgetId": 31,
    "position": WIDGET_POSITION,
    "title": "Notes",
    "updatedAt": STAMP,
}


def edit_args(**extra: Any) -> dict[str, Any]:
    return {"dashboardId": 7, **extra}


async def prepare(arguments: dict[str, Any], known_query_drafts: set[str] | None = None) -> Any:
    return await prepare_call(call("update_dashboard", **arguments), ctx(known_query_drafts=known_query_drafts))


def edit_result(operations: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "ok": True,
        "kind": "dashboard_edit",
        "dashboardId": 7,
        "snapshot": SNAPSHOT,
        "operations": operations,
        "problems": [],
    }
    return {**base, **extra}


async def complete(result: dict[str, Any], drafts: Drafts) -> Immediate:
    completer = completer_for("update_dashboard")
    assert completer is not None
    request = ClientCall(call_id="call-1", tool="update_dashboard", args=edit_args(name="x"))
    return await completer(request, result, ctx(drafts))
