import json
from typing import Any

import pytest

from tests.chat_pack_stubs import pack_context
from tests.test_chat_tools import Drafts, call
from veodyn_api.services.chat.tools import (
    ClientCall,
    Immediate,
    completer_for,
    prepare_call,
    result_kind_for,
    tool_named,
)

pytestmark = pytest.mark.anyio

SNAPSHOT = {
    "trigger": "avgspeed",
    "snippet": "SELECT avg(speed_mph) FROM regional_speeds",
    "description": "Average speed",
    "updatedAt": "2026-10-24T09:00:00.123456+00:00",
}


def check_result(mode: str, changes: dict[str, Any] | None = None, snippet_id: int = 4) -> dict[str, Any]:
    result: dict[str, Any] = {"ok": True, "kind": "snippet_check", "mode": mode, "snippetId": snippet_id}
    result["snapshot"] = SNAPSHOT
    if changes is not None:
        result["changes"] = changes
    return result


async def test_propose_snippet_saves_an_immediate_draft() -> None:
    drafts = Drafts()
    outcome = await prepare_call(
        call("propose_snippet", trigger="avgspeed", snippet="SELECT 1", description="One"), pack_context(drafts)
    )
    assert isinstance(outcome, Immediate) and not outcome.is_error
    payload = {"trigger": "avgspeed", "snippet": "SELECT 1", "description": "One"}
    assert drafts.saved == [("snippet", None, payload)]
    assert outcome.draft == {"draftId": "draft-1", "version": 1, "kind": "snippet", "payload": payload}
    assert json.loads(outcome.content)["saved"] is False


async def test_propose_snippet_description_is_optional() -> None:
    drafts = Drafts()
    outcome = await prepare_call(call("propose_snippet", trigger="t", snippet="s"), pack_context(drafts))
    assert isinstance(outcome, Immediate) and not outcome.is_error
    assert drafts.saved[0][2]["description"] == ""


@pytest.mark.parametrize(
    ("arguments", "field"),
    [
        ({"trigger": "", "snippet": "s"}, "trigger"),
        ({"trigger": "   ", "snippet": "s"}, "trigger"),
        ({"trigger": "t" * 256, "snippet": "s"}, "trigger"),
        ({"trigger": "t"}, "snippet"),
        ({"trigger": "t", "snippet": "s" * 10_001}, "snippet"),
        ({"trigger": "t", "snippet": "s", "description": "d" * 1_001}, "description"),
        ({"trigger": 5, "snippet": "s"}, "trigger"),
    ],
)
async def test_propose_snippet_refuses_out_of_range_fields(arguments: dict[str, Any], field: str) -> None:
    drafts = Drafts()
    outcome = await prepare_call(call("propose_snippet", **arguments), pack_context(drafts))
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert field in outcome.content
    assert drafts.saved == []


async def test_update_snippet_asks_the_browser() -> None:
    outcome = await prepare_call(call("update_snippet", snippetId=4, snippet="SELECT 2"), pack_context())
    assert outcome == ClientCall(call_id="call-1", tool="update_snippet", args={"snippetId": 4, "snippet": "SELECT 2"})
    assert result_kind_for("update_snippet") == "snippet_check"
    assert result_kind_for("delete_snippet") == "snippet_check"


@pytest.mark.parametrize("snippet_id", [None, 0, -1, "4", True])
async def test_update_snippet_refuses_a_bad_id(snippet_id: Any) -> None:
    outcome = await prepare_call(call("update_snippet", snippetId=snippet_id, trigger="t"), pack_context())
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert "snippetId" in outcome.content


async def test_update_snippet_needs_a_change() -> None:
    outcome = await prepare_call(call("update_snippet", snippetId=4), pack_context())
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert "trigger" in outcome.content


@pytest.mark.parametrize(
    "arguments", [{"trigger": ""}, {"trigger": "t" * 256}, {"snippet": ""}, {"description": "d" * 1_001}]
)
async def test_update_snippet_refuses_out_of_range_fields(arguments: dict[str, Any]) -> None:
    outcome = await prepare_call(call("update_snippet", snippetId=4, **arguments), pack_context())
    assert isinstance(outcome, Immediate) and outcome.is_error


async def test_update_snippet_allows_clearing_the_description() -> None:
    outcome = await prepare_call(call("update_snippet", snippetId=4, description=""), pack_context())
    assert outcome == ClientCall(call_id="call-1", tool="update_snippet", args={"snippetId": 4, "description": ""})


async def test_delete_snippet_asks_the_browser() -> None:
    outcome = await prepare_call(call("delete_snippet", snippetId=4), pack_context())
    assert outcome == ClientCall(call_id="call-1", tool="delete_snippet", args={"snippetId": 4})


async def test_delete_snippet_refuses_a_bad_id() -> None:
    outcome = await prepare_call(call("delete_snippet", snippetId=0), pack_context())
    assert isinstance(outcome, Immediate) and outcome.is_error


def test_the_tools_are_proposals_and_delete_is_flagged_by_its_draft() -> None:
    for name in ("propose_snippet", "update_snippet", "delete_snippet"):
        tool = tool_named(name)
        assert tool is not None and tool.proposal
        assert tool.requires_feature == "query_snippets"
        assert not tool.requires_pack


async def test_an_update_check_saves_a_snippet_edit_draft() -> None:
    drafts = Drafts()
    request = ClientCall(call_id="call-1", tool="update_snippet", args={"snippetId": 4, "snippet": "SELECT 2"})
    completer = completer_for("update_snippet")
    assert completer is not None
    done = await completer(request, check_result("edit", {"snippet": "SELECT 2"}), pack_context(drafts))
    assert not done.is_error
    payload = {"snippetId": 4, "snapshot": SNAPSHOT, "changes": {"snippet": "SELECT 2"}}
    assert drafts.saved == [("snippet_edit", None, payload)]
    assert done.draft == {"draftId": "draft-1", "version": 1, "kind": "snippet_edit", "payload": payload}


async def test_a_delete_check_saves_a_destructive_draft() -> None:
    drafts = Drafts()
    request = ClientCall(call_id="call-1", tool="delete_snippet", args={"snippetId": 4})
    completer = completer_for("delete_snippet")
    assert completer is not None
    done = await completer(request, check_result("delete"), pack_context(drafts))
    assert not done.is_error
    payload = {"snippetId": 4, "snapshot": SNAPSHOT, "changes": {}, "delete": True}
    assert drafts.saved == [("snippet_edit", None, payload)]
    assert done.draft is not None and done.draft["kind"] == "snippet_edit"


@pytest.mark.parametrize(
    ("tool", "result"),
    [
        ("update_snippet", check_result("edit", {"snippet": "x"}, snippet_id=9)),
        ("update_snippet", check_result("edit", {})),
        ("update_snippet", check_result("edit")),
        ("update_snippet", check_result("edit", {"colour": "red"})),
        ("update_snippet", check_result("delete")),
        ("update_snippet", check_result("edit", {"trigger": ""})),
        ("delete_snippet", check_result("edit", {"snippet": "x"})),
        ("delete_snippet", check_result("delete", snippet_id=9)),
        ("update_snippet", {**check_result("edit", {"snippet": "x"}), "snapshot": None}),
    ],
)
async def test_a_check_that_does_not_match_the_request_is_refused(tool: str, result: dict[str, Any]) -> None:
    drafts = Drafts()
    request = ClientCall(call_id="call-1", tool=tool, args={"snippetId": 4})
    completer = completer_for(tool)
    assert completer is not None
    done = await completer(request, result, pack_context(drafts))
    assert done.is_error
    assert drafts.saved == []
