from typing import Any

import pytest

from tests.dashboard_edit_stubs import ADD, POSITION, WIDGET_POSITION, edit_args, prepare
from tests.mcp_stubs import Mcp, mcp
from tests.test_chat_mcp_projection import by_name
from tests.test_chat_routes import harness, model
from veodyn_api.services.chat.prompt import chat_system
from veodyn_api.services.chat.tools import ClientCall, Immediate, result_kind_for

__all__ = ["harness", "mcp", "model"]

pytestmark = pytest.mark.anyio


async def test_update_goes_to_the_browser_with_the_same_args() -> None:
    mappings = {"day": {"type": "dashboard-add-new", "mapTo": "day"}}
    operations = [
        {**ADD, "position": POSITION, "parameterMappings": mappings},
        {"op": "add", "queryDraftId": "d-1"},
        {"op": "addText", "text": "Hello"},
        {"op": "editText", "widgetId": 31, "text": "Bye"},
        {"op": "remove", "widgetId": 32},
        {"op": "move", "widgetId": 33, "position": WIDGET_POSITION},
    ]
    arguments = edit_args(name="Ops 2", tags=["a", "b"], operations=operations)
    outcome = await prepare(arguments, {"d-1"})
    assert outcome == ClientCall(call_id="call-1", tool="update_dashboard", args=arguments)
    assert result_kind_for("update_dashboard") == "dashboard_edit"


async def test_update_accepts_a_rename_alone_and_an_empty_tag_list() -> None:
    assert isinstance(await prepare(edit_args(name="Ops")), ClientCall)
    assert isinstance(await prepare(edit_args(tags=[])), ClientCall)


def with_position(**changes: Any) -> dict[str, Any]:
    return edit_args(operations=[{**ADD, "position": {**POSITION, **changes}}])


@pytest.mark.parametrize(
    ("arguments", "field"),
    [
        ({"dashboardId": 0, "name": "x"}, "dashboardId"),
        ({"dashboardId": True, "name": "x"}, "dashboardId"),
        (edit_args(), "at least one"),
        (edit_args(operations=[]), "operations"),
        (edit_args(operations=[ADD] * 31), "30"),
        (edit_args(name=""), "name"),
        (edit_args(name="n" * 201), "name"),
        (edit_args(tags="a"), "tags"),
        (edit_args(tags=["a"] * 11), "tags"),
        (edit_args(tags=["a" * 65]), "tags"),
        (edit_args(operations=[{"op": "explode", "widgetId": 1}]), "op"),
        (edit_args(operations=["add"]), "operations"),
        (edit_args(operations=[{"op": "add", "queryId": 5}]), "visualizationId"),
        (
            edit_args(operations=[{"op": "add", "queryDraftId": "d-1", "queryId": 5, "visualizationId": 9}]),
            "queryDraftId",
        ),
        (with_position(col=6), "position"),
        (with_position(col=4, sizeX=3), "position"),
        (with_position(sizeX=0), "position"),
        (with_position(sizeX=7), "position"),
        (with_position(sizeY=41), "position"),
        (with_position(row=-1), "position"),
        (with_position(col=1.5), "position"),
        (edit_args(operations=[{**ADD, "position": {"col": 0, "row": 0, "sizeX": 3}}]), "position"),
        (edit_args(operations=[{**ADD, "parameterMappings": {"a": {"type": "other"}}}]), "parameterMappings"),
        (edit_args(operations=[{**ADD, "parameterMappings": []}]), "parameterMappings"),
        (edit_args(operations=[{**ADD, "title": "x"}]), "title"),
        (edit_args(operations=[{"op": "addText", "text": ""}]), "text"),
        (edit_args(operations=[{"op": "addText", "text": "x" * 4001}]), "text"),
        (edit_args(operations=[{"op": "editText", "text": "x"}]), "widgetId"),
        (edit_args(operations=[{"op": "editText", "widgetId": 1, "text": " "}]), "text"),
        (edit_args(operations=[{"op": "remove"}]), "widgetId"),
        (edit_args(operations=[{"op": "move", "widgetId": 1}]), "position"),
        (edit_args(operations=[{"op": "move", "position": POSITION}]), "widgetId"),
        (
            edit_args(
                operations=[{"op": "remove", "widgetId": 1}, {"op": "move", "widgetId": 1, "position": POSITION}]
            ),
            "widgetId",
        ),
    ],
)
async def test_update_refusals(arguments: dict[str, Any], field: str) -> None:
    outcome = await prepare(arguments)
    assert isinstance(outcome, Immediate) and outcome.is_error and field in outcome.content


async def test_update_refuses_a_query_draft_from_another_thread() -> None:
    outcome = await prepare(edit_args(operations=[{"op": "add", "queryDraftId": "other"}]), {"d-1"})
    assert isinstance(outcome, Immediate) and outcome.is_error and "queryDraftId" in outcome.content


def test_mcp_lists_update_dashboard_as_a_proposal(mcp: Mcp) -> None:
    listed = by_name(mcp.tools())
    assert listed["update_dashboard"]["inputSchema"]["properties"]["threadId"]["type"] == "string"


def test_the_prompt_tells_the_model_to_edit_by_operations() -> None:
    text = "\n".join(block["text"] for block in chat_system((), omitted_history=False))
    assert "`update_dashboard`" in text
    assert "second click" in text


async def test_an_explicit_null_static_value_survives_to_the_browser() -> None:
    mappings = {"city": {"type": "static-value", "value": None}}
    arguments = edit_args(operations=[{**ADD, "parameterMappings": mappings}])
    outcome = await prepare(arguments)
    assert isinstance(outcome, ClientCall)
    assert outcome.args["operations"][0]["parameterMappings"] == mappings
