from collections.abc import Iterator
from typing import Any

import pytest

from tests.mcp_stubs import Mcp, mcp, warehouse_context
from tests.test_chat_routes import harness, model
from tests.test_chat_tools import call, context
from veodyn_api.schemas.ai_chat_context import ChatInstanceIn
from veodyn_api.services.chat import tools
from veodyn_api.services.chat.mcp_tools import mcp_tool_definitions
from veodyn_api.services.chat.tools import ChatTool, Immediate, prepare_call, tool_definitions

__all__ = ["harness", "mcp", "model"]

pytestmark = pytest.mark.anyio

PACK_ONLY = {"propose_kpi", "propose_report", "propose_message"}
SNIPPETS = {"propose_snippet", "update_snippet", "delete_snippet"}
PACK_FEATURES = ["kpis", "reports", "messages"]
FEATURE_OF = {"propose_kpi": "kpis", "propose_report": "reports", "propose_message": "messages"}


def names(definitions: list[dict[str, Any]]) -> set[str]:
    return {one["name"] for one in definitions}


def instance(edition: str, *features: str) -> dict[str, Any]:
    return {"name": "Test", "edition": edition, "features": list(features)}


@pytest.fixture
def registry(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(tools, "_TOOLS", dict(tools._TOOLS))
    yield


def test_a_pack_tool_is_not_offered_without_an_edition() -> None:
    assert not PACK_ONLY & names(tool_definitions())


def test_a_pack_tool_is_not_offered_on_a_community_instance() -> None:
    assert not PACK_ONLY & names(tool_definitions(edition="CE"))


@pytest.mark.parametrize("edition", ["EE", "HUB"])
def test_a_pack_tool_is_offered_where_the_pack_is_installed(edition: str) -> None:
    assert PACK_ONLY <= names(tool_definitions(edition=edition, features=PACK_FEATURES))


@pytest.mark.parametrize("tool", sorted(PACK_ONLY))
def test_a_pack_tool_needs_its_own_feature_switched_on(tool: str) -> None:
    assert tool not in names(tool_definitions(edition="EE"))
    others = [feature for feature in PACK_FEATURES if feature != FEATURE_OF[tool]]
    assert tool not in names(tool_definitions(edition="EE", features=others))
    assert tool in names(tool_definitions(edition="EE", features=[FEATURE_OF[tool]]))


def test_snippet_tools_need_the_snippets_feature() -> None:
    assert not SNIPPETS & names(tool_definitions(edition="CE"))
    assert not SNIPPETS & names(tool_definitions(edition="CE", features=["messages"]))
    assert SNIPPETS <= names(tool_definitions(edition="CE", features=["query_snippets"]))


def test_a_community_instance_with_snippets_gets_no_pack_tool() -> None:
    listed = names(tool_definitions(edition="CE", features=["query_snippets"]))
    assert not PACK_ONLY & listed


@pytest.mark.anyio
async def test_a_call_to_an_unoffered_tool_is_refused() -> None:
    outcome = await prepare_call(
        call("propose_message", header="Detour", description="Route 4 is detoured."), context()
    )
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert "no tool called" in outcome.content


def test_mcp_listing_applies_the_same_rule(mcp: Mcp) -> None:
    assert not (PACK_ONLY | SNIPPETS) & names(mcp.tools())
    assert not PACK_ONLY & names(mcp.tools(instance=instance("CE", "query_snippets")))
    assert SNIPPETS <= names(mcp.tools(instance=instance("CE", "query_snippets")))
    assert not PACK_ONLY & names(mcp.tools(instance=instance("EE")))
    assert PACK_ONLY <= names(mcp.tools(instance=instance("EE", *PACK_FEATURES)))


def test_mcp_listing_function_takes_the_instance() -> None:
    assert not PACK_ONLY & names(mcp_tool_definitions())
    instance_in = ChatInstanceIn(name="T", edition="EE", features=PACK_FEATURES)
    assert PACK_ONLY <= names(mcp_tool_definitions(instance=instance_in))


def test_mcp_call_of_a_pack_tool_on_community_is_refused(mcp: Mcp) -> None:
    done = mcp.call(
        "propose_message",
        {"header": "Detour", "description": "Route 4 is detoured."},
        {**warehouse_context(), "instance": instance("CE")},
    )
    assert done["kind"] == "done" and done["isError"] is True


def test_mcp_call_of_a_pack_tool_on_enterprise_is_accepted(mcp: Mcp) -> None:
    done = mcp.call(
        "propose_message",
        {"header": "Detour", "description": "Route 4 is detoured."},
        {**warehouse_context(), "instance": instance("EE", "messages")},
    )
    assert done["kind"] == "done" and done["isError"] is False


def test_a_pack_registered_tool_can_declare_requires_pack(registry: None) -> None:
    async def handler(call_id: str, arguments: dict[str, Any], ctx: Any) -> Immediate:
        return Immediate("x", is_error=False)

    definition = {"name": "pack_thing", "description": "d", "input_schema": {"type": "object", "properties": {}}}
    tools.register_chat_tool(ChatTool(name="pack_thing", definition=definition, handler=handler, requires_pack=True))
    assert "pack_thing" not in names(tool_definitions(edition="CE"))
    assert "pack_thing" in names(tool_definitions(edition="EE"))
