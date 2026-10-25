from typing import Any

from tests.test_chat_tools import Drafts, context
from veodyn_api.services.chat.tools import (
    ClientCall,
    DataSourceInfo,
    Immediate,
    ToolContext,
    completer_for,
)

SQL_SOURCE = {1: DataSourceInfo(syntax="sql", view_only=False)}

SNAPSHOT: dict[str, Any] = {
    "id": 5,
    "name": "Trips",
    "description": "Trips per day",
    "sql": "select 1",
    "dataSourceId": 1,
    "parameters": [],
    "tags": ["bikeshare"],
    "schedule": None,
    "isDraft": False,
    "updatedAt": "2026-10-24T09:00:00.123456+00:00",
}

DETAIL: dict[str, Any] = {
    "ok": True,
    "kind": "query_detail",
    "query": {
        **SNAPSHOT,
        "canEdit": True,
        "visualizations": [{"id": 9, "name": "Table", "type": "TABLE"}],
    },
}


def call(tool_name: str, /, **arguments: Any) -> dict[str, Any]:
    return {"type": "tool_use", "id": "call-1", "name": tool_name, "input": arguments}


def update_call(changes: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return call("update_query", queryId=5, changes=changes, **extra)


def edit_result(changes: dict[str, Any], snapshot: dict[str, Any] | None = None, query_id: int = 5) -> dict[str, Any]:
    return {
        "ok": True,
        "kind": "query_edit",
        "queryId": query_id,
        "snapshot": snapshot or SNAPSHOT,
        "changes": changes,
    }


def ctx(drafts: Drafts | None = None, **kwargs: Any) -> ToolContext:
    return context(drafts, **{"known_sources": SQL_SOURCE, **kwargs})


REQUEST = ClientCall(call_id="call-1", tool="update_query", args={"queryId": 5, "changes": {}})


async def complete(result: dict[str, Any], tool_context: ToolContext) -> Immediate:
    completer = completer_for("update_query")
    assert completer is not None
    return await completer(REQUEST, result, tool_context)
