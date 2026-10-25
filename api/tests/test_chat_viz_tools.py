import json
from typing import Any

import pytest
from pydantic import TypeAdapter, ValidationError

from tests.mcp_stubs import Mcp, mcp
from tests.query_edit_stubs import call, ctx
from tests.test_chat_mcp_projection import by_name
from tests.test_chat_routes import harness, model
from tests.test_chat_tools import Drafts, context
from veodyn_api.schemas.ai_chat_results import ChatToolResultIn
from veodyn_api.services.chat.tools import (
    ClientCall,
    Immediate,
    completer_for,
    prepare_call,
    registered_tools,
    result_kind_for,
)

__all__ = ["harness", "mcp", "model"]

pytestmark = pytest.mark.anyio

RESULT = TypeAdapter(ChatToolResultIn)
NEXT = {"type": "CHART", "name": "Speed", "options": {"globalSeriesType": "line"}}
SNAP = {"type": "CHART", "name": "Old", "options": {}, "updatedAt": "2026-10-24T09:00:00+00:00"}
QUERY_BASE = {
    "name": "T",
    "datasetTable": "regional_speeds",
    "sql": "SELECT 1 FROM regional_speeds",
    "vizChoiceId": "table",
}


def check(mode: str, **extra: Any) -> dict[str, Any]:
    base: dict[str, Any] = {"ok": True, "kind": "visualization_check", "mode": mode, "queryId": 5, "problems": []}
    return {**base, **extra}


async def complete(tool: str, result: dict[str, Any], drafts: Drafts) -> Immediate:
    completer = completer_for(tool)
    assert completer is not None
    args = {"queryId": 5} if tool == "propose_visualization" else {"queryId": 5, "visualizationId": 9}
    return await completer(ClientCall(call_id="call-1", tool=tool, args=args), result, ctx(drafts))


async def test_describe_asks_the_browser() -> None:
    outcome = await prepare_call(call("describe_visualization_type", type="CHART"), ctx())
    assert outcome == ClientCall(call_id="call-1", tool="describe_visualization_type", args={"type": "CHART"})
    assert result_kind_for("describe_visualization_type") == "visualization_type"


@pytest.mark.parametrize("value", [None, "", 3, "x" * 65])
async def test_describe_refuses_a_bad_type(value: Any) -> None:
    outcome = await prepare_call(call("describe_visualization_type", type=value), ctx())
    assert isinstance(outcome, Immediate) and outcome.is_error and "type" in outcome.content


async def test_propose_goes_to_the_browser_with_the_same_args() -> None:
    options = {"globalSeriesType": "line"}
    outcome = await prepare_call(
        call("propose_visualization", queryId=5, type="CHART", name="Speed", options=options), ctx()
    )
    assert outcome == ClientCall(
        call_id="call-1",
        tool="propose_visualization",
        args={"queryId": 5, "type": "CHART", "name": "Speed", "options": options},
    )
    assert result_kind_for("propose_visualization") == "visualization_check"


@pytest.mark.parametrize(
    ("arguments", "field"),
    [
        ({"queryId": 0, "type": "CHART", "name": "n", "options": {}}, "queryId"),
        ({"queryId": 5, "type": "", "name": "n", "options": {}}, "type"),
        ({"queryId": 5, "type": "CHART", "name": "", "options": {}}, "name"),
        ({"queryId": 5, "type": "CHART", "name": "n" * 256, "options": {}}, "name"),
        ({"queryId": 5, "type": "CHART", "name": "n", "options": []}, "options"),
        ({"queryId": 5, "type": "CHART", "name": "n", "options": {"a": "x" * 20_000}}, "options"),
    ],
)
async def test_propose_refusals(arguments: dict[str, Any], field: str) -> None:
    outcome = await prepare_call(call("propose_visualization", **arguments), ctx())
    assert isinstance(outcome, Immediate) and outcome.is_error and field in outcome.content


async def test_update_goes_to_the_browser_with_the_same_args() -> None:
    outcome = await prepare_call(
        call(
            "update_visualization",
            queryId=5,
            visualizationId=9,
            name="New",
            set=[{"path": "yAxis.0.rangeMin", "value": 0}],
            unset=["legend"],
        ),
        ctx(),
    )
    assert outcome == ClientCall(
        call_id="call-1",
        tool="update_visualization",
        args={
            "queryId": 5,
            "visualizationId": 9,
            "name": "New",
            "set": [{"path": "yAxis.0.rangeMin", "value": 0}],
            "unset": ["legend"],
        },
    )
    assert result_kind_for("update_visualization") == "visualization_check"


@pytest.mark.parametrize(
    ("arguments", "field"),
    [
        ({"visualizationId": 9, "name": "x"}, "queryId"),
        ({"queryId": 5, "name": "x"}, "visualizationId"),
        ({"queryId": 5, "visualizationId": 9}, "at least one"),
        ({"queryId": 5, "visualizationId": 9, "set": [{"path": "", "value": 1}]}, "set"),
        ({"queryId": 5, "visualizationId": 9, "set": [{"value": 1}]}, "set"),
        ({"queryId": 5, "visualizationId": 9, "set": [{"path": "a", "value": 1}] * 51}, "set"),
        ({"queryId": 5, "visualizationId": 9, "unset": [""]}, "unset"),
        ({"queryId": 5, "visualizationId": 9, "unset": ["a"] * 51}, "unset"),
        ({"queryId": 5, "visualizationId": 9, "name": "n" * 256}, "name"),
        ({"queryId": 5, "visualizationId": 9, "set": [{"path": "a", "value": "x" * 20_000}]}, "set"),
    ],
)
async def test_update_refusals(arguments: dict[str, Any], field: str) -> None:
    outcome = await prepare_call(call("update_visualization", **arguments), ctx())
    assert isinstance(outcome, Immediate) and outcome.is_error and field in outcome.content


async def test_delete_goes_to_the_browser_and_refuses_bad_ids() -> None:
    outcome = await prepare_call(call("delete_visualization", queryId=5, visualizationId=9), ctx())
    assert outcome == ClientCall(
        call_id="call-1", tool="delete_visualization", args={"queryId": 5, "visualizationId": 9}
    )
    assert result_kind_for("delete_visualization") == "visualization_check"
    for arguments in ({"visualizationId": 9}, {"queryId": 5}, {"queryId": 5, "visualizationId": 0}):
        refused = await prepare_call(call("delete_visualization", **arguments), ctx())
        assert isinstance(refused, Immediate) and refused.is_error


async def test_completer_saves_a_new_visualization_draft() -> None:
    drafts = Drafts()
    done = await complete("propose_visualization", check("new", next=NEXT), drafts)
    assert not done.is_error
    payload = {"mode": "new", "queryId": 5, "next": NEXT}
    assert drafts.saved == [("visualization", None, payload)]
    assert json.loads(done.content) == {"draftId": "draft-1", "version": 1}
    assert done.draft == {"draftId": "draft-1", "version": 1, "kind": "visualization", "payload": payload}


async def test_completer_saves_an_edit_draft_with_snapshot() -> None:
    drafts = Drafts()
    result = check("edit", visualizationId=9, snapshot=SNAP, next=NEXT)
    done = await complete("update_visualization", result, drafts)
    assert not done.is_error
    assert drafts.saved[0][2] == {"mode": "edit", "queryId": 5, "visualizationId": 9, "snapshot": SNAP, "next": NEXT}


async def test_completer_saves_a_delete_draft_without_next() -> None:
    drafts = Drafts()
    done = await complete("delete_visualization", check("delete", visualizationId=9, snapshot=SNAP), drafts)
    assert not done.is_error
    assert drafts.saved[0][2] == {"mode": "delete", "queryId": 5, "visualizationId": 9, "snapshot": SNAP}


async def test_completer_returns_problems_to_the_model() -> None:
    drafts = Drafts()
    result = check("new", next=NEXT, problems=["columnMapping: no column named speed"])
    done = await complete("propose_visualization", result, drafts)
    assert done.is_error and "no column named speed" in done.content
    assert drafts.saved == []


@pytest.mark.parametrize(
    ("tool", "result"),
    [
        ("propose_visualization", check("new")),
        ("propose_visualization", check("edit", visualizationId=9, snapshot=SNAP, next=NEXT)),
        ("update_visualization", check("edit", next=NEXT)),
        ("update_visualization", check("edit", visualizationId=9, next=NEXT)),
        ("delete_visualization", check("delete", visualizationId=9)),
        ("delete_visualization", check("new", next=NEXT)),
    ],
)
async def test_completer_refuses_an_incomplete_or_mismatched_result(tool: str, result: dict[str, Any]) -> None:
    drafts = Drafts()
    done = await complete(tool, result, drafts)
    assert done.is_error
    assert drafts.saved == []


async def test_propose_query_stores_viz_options() -> None:
    drafts = Drafts()
    options = {"globalSeriesType": "line"}
    done = await prepare_call(call("propose_query", **QUERY_BASE, vizOptions=options), context(drafts))
    assert isinstance(done, Immediate) and not done.is_error, done
    assert drafts.saved[0][2]["vizOptions"] == options
    plain = Drafts()
    await prepare_call(call("propose_query", **QUERY_BASE), context(plain))
    assert plain.saved[0][2]["vizOptions"] == {}


@pytest.mark.parametrize("options", [[], "x", {"a": "x" * 20_000}])
async def test_propose_query_refuses_bad_viz_options(options: Any) -> None:
    done = await prepare_call(call("propose_query", **QUERY_BASE, vizOptions=options), context(Drafts()))
    assert isinstance(done, Immediate) and done.is_error and "vizOptions" in done.content


def test_the_two_result_kinds_are_accepted() -> None:
    kind = {"ok": True, "kind": "visualization_type", "type": "CHART", "label": "Chart", "options": [{"key": "a"}]}
    assert RESULT.validate_python(kind).kind == "visualization_type"
    assert RESULT.validate_python(check("edit", visualizationId=9, snapshot=SNAP, next=NEXT)).kind == (
        "visualization_check"
    )
    assert RESULT.validate_python({"ok": False, "kind": "visualization_check", "error": "no"}).kind == (
        "visualization_check"
    )


@pytest.mark.parametrize(
    "bad",
    [
        {"ok": True, "kind": "visualization_type", "type": "C", "label": "C", "options": [{}] * 81},
        check("new", problems=["p"] * 21),
        check("sideways"),
        check("new", queryId=0),
    ],
)
def test_malformed_results_are_refused(bad: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        RESULT.validate_python(bad)


def test_mcp_lists_the_four_tools_and_three_are_proposals(mcp: Mcp) -> None:
    on = by_name(mcp.tools(chat_enabled=True))
    off = by_name(mcp.tools(chat_enabled=False))
    describe = "describe_visualization_type"
    proposals = {"propose_visualization", "update_visualization", "delete_visualization"}
    assert proposals | {describe} <= set(on)
    assert describe in off
    assert not proposals & set(off)
    flagged = {tool.name for tool in registered_tools() if tool.proposal}
    assert proposals <= flagged
    assert describe not in flagged
