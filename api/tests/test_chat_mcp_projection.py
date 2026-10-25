from collections.abc import Iterator
from typing import Any

import pytest

from tests.mcp_stubs import Mcp, mcp
from tests.test_chat_routes import harness, model
from veodyn_api.services.chat import tools
from veodyn_api.services.chat.tools import ChatTool, ClientCall, Immediate, ToolContext

__all__ = ["harness", "mcp", "model"]

PROPOSALS = {
    "propose_query",
    "propose_dashboard",
    "update_query",
    "propose_visualization",
    "update_visualization",
    "delete_visualization",
    "update_dashboard",
    "fork_query",
    "archive_query",
    "archive_dashboard",
    "set_favorite",
    "share_dashboard",
    "share_visualization",
}


def by_name(listed: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {one["name"]: one for one in listed}


async def foreign_handler(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    return Immediate("x", is_error=False)


foreign_handler.__module__ = "veodyn_enterprise.chat"


def pack_tool(name: str, **extra: Any) -> ChatTool:
    definition = {"name": name, "description": "d", "input_schema": {"type": "object", "properties": {}}}
    return ChatTool(name=name, definition=definition, handler=foreign_handler, **extra)


@pytest.fixture
def registry(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(tools, "_TOOLS", dict(tools._TOOLS))
    yield


def test_tools_list_drops_presentation_fields(mcp: Mcp) -> None:
    listed = by_name(mcp.tools())
    for name in ("run_query", "run_saved_query"):
        schema = listed[name]["inputSchema"]
        assert "vizChoiceId" not in schema["properties"]
        assert "purpose" not in schema["properties"]
        assert "vizChoiceId" not in schema.get("required", [])
        assert "purpose" not in schema.get("required", [])
    assert "sql" in listed["run_query"]["inputSchema"]["properties"]
    assert "queryId" in listed["run_saved_query"]["inputSchema"]["properties"]
    assert "vizChoiceId" in listed["propose_query"]["inputSchema"]["properties"]
    assert set(listed["run_query"]) == {"name", "description", "inputSchema"}


def test_tools_list_hides_proposals_when_chat_off(mcp: Mcp) -> None:
    on = set(by_name(mcp.tools(chat_enabled=True)))
    off = set(by_name(mcp.tools(chat_enabled=False)))
    assert PROPOSALS <= on
    assert not PROPOSALS & off
    assert off == on - PROPOSALS
    assert {"run_query", "open_query", "search_library"} <= off


def test_tools_list_carries_the_operation_tools(mcp: Mcp) -> None:
    listed = by_name(mcp.tools(chat_enabled=True))
    assert "download_result" in listed
    assert "download_result" in by_name(mcp.tools(chat_enabled=False))
    assert "threadId" not in listed["download_result"]["inputSchema"]["properties"]


def test_tools_list_adds_thread_id_to_proposals(mcp: Mcp) -> None:
    listed = by_name(mcp.tools())
    for name in PROPOSALS:
        assert listed[name]["inputSchema"]["properties"]["threadId"]["type"] == "string"
    assert "threadId" not in listed["run_query"]["inputSchema"]["properties"]


def test_tools_registered_outside_the_api_package_are_chat_only(mcp: Mcp, registry: None) -> None:
    tools.register_chat_tool(pack_tool("show_kpi"))
    listed = by_name(mcp.tools())
    assert "show_kpi" not in listed
    assert "run_query" in listed


def test_a_pack_tool_that_declares_mcp_runnable_is_listed(mcp: Mcp, registry: None) -> None:
    tools.register_chat_tool(pack_tool("list_kpis", mcp_runnable=True))
    assert "list_kpis" in by_name(mcp.tools())


def test_a_chat_only_tool_cannot_be_called_over_mcp(mcp: Mcp, registry: None) -> None:
    tools.register_chat_tool(pack_tool("show_kpi"))
    done = mcp.call("show_kpi", {})
    assert done["kind"] == "done" and done["isError"] is True
