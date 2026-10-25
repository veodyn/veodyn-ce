from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any

from veodyn_api.schemas.ai_chat_operation import DOWNLOAD_FORMATS, MAX_EXPIRES_AT_CHARS, REFRESH_SECONDS
from veodyn_api.services.chat.tools import ClientCall, Immediate, ToolContext, positive_id

FAVORITE_KINDS = ("query", "dashboard")
SHARE_ACTIONS = ("create", "revoke")
EXPIRES_AT_NOTE = f"ISO 8601 date and time, up to {MAX_EXPIRES_AT_CHARS} characters."


def refused(message: str) -> Immediate:
    return Immediate(message, is_error=True)


def _id_or_refusal(arguments: dict[str, Any], name: str, what: str) -> int | Immediate:
    found = positive_id(arguments.get(name))
    return found if found is not None else refused(f"{name} must be the id of {what}")


def _restore_flag(arguments: dict[str, Any]) -> bool | Immediate:
    restore = arguments.get("restore", False)
    return restore if isinstance(restore, bool) else refused("restore must be true or false")


def _action(arguments: dict[str, Any]) -> str | Immediate:
    action = arguments.get("action")
    if action in SHARE_ACTIONS:
        return str(action)
    return refused(f"action must be one of {', '.join(SHARE_ACTIONS)}")


def _expires_at(arguments: dict[str, Any], action: str) -> str | None | Immediate:
    raw = arguments.get("expiresAt")
    if raw is None:
        return None
    if action != "create":
        return refused("expiresAt only applies when creating a link")
    text = raw.strip() if isinstance(raw, str) else ""
    if not text or len(text) > MAX_EXPIRES_AT_CHARS:
        return refused(f"expiresAt must be an {EXPIRES_AT_NOTE}")
    try:
        datetime.fromisoformat(text)
    except ValueError:
        return refused(f"expiresAt must be an {EXPIRES_AT_NOTE}")
    return text


def _refresh_seconds(arguments: dict[str, Any], action: str) -> int | None | Immediate:
    raw = arguments.get("refreshSeconds")
    if raw is None:
        return None
    if action != "create":
        return refused("refreshSeconds only applies when creating a link")
    if isinstance(raw, bool) or not isinstance(raw, int) or raw not in REFRESH_SECONDS:
        return refused(f"refreshSeconds must be one of {', '.join(str(one) for one in REFRESH_SECONDS)}")
    return raw


async def fork_query(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    query_id = _id_or_refusal(arguments, "queryId", "a saved query")
    if isinstance(query_id, Immediate):
        return query_id
    return ClientCall(call_id=call_id, tool="fork_query", args={"queryId": query_id})


def archive_handler(tool: str, id_name: str, what: str) -> Callable[..., Awaitable[ClientCall | Immediate]]:
    async def handle(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
        found = _id_or_refusal(arguments, id_name, what)
        if isinstance(found, Immediate):
            return found
        restore = _restore_flag(arguments)
        if isinstance(restore, Immediate):
            return restore
        return ClientCall(call_id=call_id, tool=tool, args={id_name: found, "restore": restore})

    return handle


async def set_favorite(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    kind = arguments.get("kind")
    if kind not in FAVORITE_KINDS:
        return refused(f"kind must be one of {', '.join(FAVORITE_KINDS)}")
    found = _id_or_refusal(arguments, "id", f"a saved {kind}")
    if isinstance(found, Immediate):
        return found
    favorite = arguments.get("favorite")
    if not isinstance(favorite, bool):
        return refused("favorite must be true or false")
    return ClientCall(call_id=call_id, tool="set_favorite", args={"kind": kind, "id": found, "favorite": favorite})


async def share_dashboard(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    dashboard_id = _id_or_refusal(arguments, "dashboardId", "a saved dashboard")
    if isinstance(dashboard_id, Immediate):
        return dashboard_id
    action = _action(arguments)
    if isinstance(action, Immediate):
        return action
    expires_at = _expires_at(arguments, action)
    if isinstance(expires_at, Immediate):
        return expires_at
    return ClientCall(
        call_id=call_id,
        tool="share_dashboard",
        args={"dashboardId": dashboard_id, "action": action, "expiresAt": expires_at},
    )


async def share_visualization(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    query_id = _id_or_refusal(arguments, "queryId", "the saved query that owns the chart")
    if isinstance(query_id, Immediate):
        return query_id
    visualization_id = _id_or_refusal(arguments, "visualizationId", "one of the query's visualizations")
    if isinstance(visualization_id, Immediate):
        return visualization_id
    action = _action(arguments)
    if isinstance(action, Immediate):
        return action
    expires_at = _expires_at(arguments, action)
    if isinstance(expires_at, Immediate):
        return expires_at
    refresh = _refresh_seconds(arguments, action)
    if isinstance(refresh, Immediate):
        return refresh
    return ClientCall(
        call_id=call_id,
        tool="share_visualization",
        args={
            "queryId": query_id,
            "visualizationId": visualization_id,
            "action": action,
            "expiresAt": expires_at,
            "refreshSeconds": refresh,
        },
    )


async def download_result(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    query_id = _id_or_refusal(arguments, "queryId", "a saved query")
    if isinstance(query_id, Immediate):
        return query_id
    file_format = arguments.get("format")
    if file_format not in DOWNLOAD_FORMATS:
        return refused(f"format must be one of {', '.join(DOWNLOAD_FORMATS)}")
    return ClientCall(call_id=call_id, tool="download_result", args={"queryId": query_id, "format": file_format})
