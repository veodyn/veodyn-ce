from typing import Any

import pytest

from tests.catalog_stubs import SPEEDS
from veodyn_api.services.chat import tools
from veodyn_api.services.chat.tools import ClientCall, Immediate, ToolContext, prepare_call, tool_definitions

pytestmark = pytest.mark.anyio


def context() -> ToolContext:
    async def data_source_id() -> int:
        return 5

    async def draft_exists(draft_id: str) -> bool:
        return False

    async def save_draft(kind: str, draft_id: str | None, payload: dict[str, Any]) -> tuple[str, int]:
        return "d", 1

    return ToolContext(
        datasets=(SPEEDS,),
        data_source_id=data_source_id,
        data_source_info=lambda source_id: None,
        save_draft=save_draft,
        query_draft_exists=draft_exists,
    )


def call(**arguments: Any) -> dict[str, Any]:
    return {"type": "tool_use", "id": "call-1", "name": "run_saved_query", "input": arguments}


async def test_valid_call_goes_to_browser() -> None:
    outcome = await prepare_call(
        call(
            queryId=137,
            params={
                "route": "R720",
                "limit": 5,
                "ratio": 0.5,
                "stops": ["a", "b"],
                "window": {"start": "2026-10-01", "end": "2026-10-02"},
            },
            visualizationId=165,
            purpose="show the route live",
        ),
        context(),
    )
    assert outcome == ClientCall(
        call_id="call-1",
        tool="run_saved_query",
        args={
            "queryId": 137,
            "parameters": {
                "route": "R720",
                "limit": 5,
                "ratio": 0.5,
                "stops": ["a", "b"],
                "window": {"start": "2026-10-01", "end": "2026-10-02"},
            },
            "visualizationId": 165,
            "purpose": "show the route live",
        },
    )


async def test_params_and_visualization_are_optional() -> None:
    outcome = await prepare_call(call(queryId=3, purpose="x"), context())
    assert isinstance(outcome, ClientCall)
    assert outcome.args["parameters"] == {}
    assert outcome.args["visualizationId"] is None


@pytest.mark.parametrize("query_id", [None, 0, -4, "abc"])
async def test_rejects_a_missing_or_nonpositive_query_id(query_id: Any) -> None:
    outcome = await prepare_call(call(queryId=query_id, purpose="x"), context())
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert "queryId" in outcome.content


async def test_rejects_a_bad_visualization_id() -> None:
    outcome = await prepare_call(call(queryId=3, visualizationId=-1, purpose="x"), context())
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert "visualizationId" in outcome.content


@pytest.mark.parametrize(
    "params",
    [
        {"a": {"nested": {"deep": 1}}},
        {"a": {"start": "x"}},
        {"a": {"start": 1, "end": 2}},
        {"a": [1, 2]},
        {"a": [["x"]]},
        {"a": True},
        {"a": None},
        {"": "x"},
    ],
)
async def test_rejects_nested_objects_other_than_ranges(params: dict[str, Any]) -> None:
    outcome = await prepare_call(call(queryId=3, params=params, purpose="x"), context())
    assert isinstance(outcome, Immediate) and outcome.is_error


async def test_rejects_params_that_are_not_an_object() -> None:
    outcome = await prepare_call(call(queryId=3, params=["a"], purpose="x"), context())
    assert isinstance(outcome, Immediate) and outcome.is_error


async def test_rejects_oversized_params() -> None:
    too_many = {f"p{index}": "v" for index in range(21)}
    too_long = {"a": "x" * 4_001}
    long_list = {"a": ["x"] * 51}
    for params in (too_many, too_long, long_list):
        outcome = await prepare_call(call(queryId=3, params=params, purpose="x"), context())
        assert isinstance(outcome, Immediate) and outcome.is_error


@pytest.mark.parametrize(
    "params",
    [
        {"a": "x" * 501},
        {"a": ["x" * 501]},
        {"a": {"start": "x" * 65, "end": "2026-10-24"}},
        {"a": {"start": "2026-10-01", "end": "x" * 65}},
    ],
)
async def test_values_the_browser_frame_would_reject_are_refused_here(params: dict[str, Any]) -> None:
    outcome = await prepare_call(call(queryId=3, params=params, purpose="x"), context())
    assert isinstance(outcome, Immediate) and outcome.is_error


async def test_values_at_the_browser_frame_limits_are_accepted() -> None:
    params = {"a": "x" * 500, "b": ["y" * 500], "c": {"start": "s" * 64, "end": "e" * 64}}
    outcome = await prepare_call(call(queryId=3, params=params, purpose="x"), context())
    assert isinstance(outcome, ClientCall)


async def test_a_list_at_the_limit_is_accepted() -> None:
    outcome = await prepare_call(call(queryId=3, params={"a": ["x"] * 50}, purpose="x"), context())
    assert isinstance(outcome, ClientCall)


def test_definition_registered_once() -> None:
    names = [definition["name"] for definition in tool_definitions()]
    assert names.count("run_saved_query") == 1
    with pytest.raises(ValueError):
        tools.register_chat_tool(tools._TOOLS["run_saved_query"])


def test_definition_requires_query_id_and_purpose() -> None:
    [definition] = [one for one in tool_definitions() if one["name"] == "run_saved_query"]
    assert definition["input_schema"]["required"] == ["queryId", "purpose"]
    assert set(definition["input_schema"]["properties"]) == {"queryId", "params", "visualizationId", "purpose"}


def test_result_kind_is_query_result() -> None:
    assert tools.result_kind_for("run_saved_query") == "query_result"
