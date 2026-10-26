from typing import Any

import pytest

from tests.test_chat_tools import call, context
from veodyn_api.services.chat import tools
from veodyn_api.services.chat.tools import ClientCall, Immediate, prepare_call

pytestmark = pytest.mark.anyio


async def test_a_library_search_goes_to_the_browser_with_both_kinds_by_default() -> None:
    outcome = await prepare_call(call("search_library", text="  bikeshare "), context())
    assert outcome == ClientCall(
        call_id="call-1",
        tool="search_library",
        args={"text": "bikeshare", "kinds": ["query", "dashboard"], "tags": [], "sort": "match", "archived": False},
    )


async def test_a_library_search_keeps_known_kinds_and_caps_tags() -> None:
    tags = [f"tag-{index}" for index in range(8)] + ["", 3]
    outcome = await prepare_call(
        call("search_library", text="", kinds=["dashboard", "report", "dashboard"], tags=tags), context()
    )
    assert isinstance(outcome, ClientCall)
    assert outcome.args == {"text": "", "kinds": ["dashboard"], "tags": tags[:5], "sort": "match", "archived": False}


async def test_a_library_search_with_no_known_kind_is_refused() -> None:
    outcome = await prepare_call(call("search_library", text="x", kinds=["report"]), context())
    assert isinstance(outcome, Immediate) and outcome.is_error


async def test_showing_a_visualization_passes_the_ids_through() -> None:
    outcome = await prepare_call(call("show_visualization", queryId=12, visualizationId=31), context())
    assert outcome == ClientCall(
        call_id="call-1", tool="show_visualization", args={"queryId": 12, "visualizationId": 31}
    )
    bare = await prepare_call(call("show_visualization", queryId=12), context())
    assert isinstance(bare, ClientCall) and bare.args == {"queryId": 12, "visualizationId": None}


@pytest.mark.parametrize("query_id", [0, -1, True, "12", None, 1.5])
async def test_showing_a_visualization_needs_a_real_query_id(query_id: Any) -> None:
    outcome = await prepare_call(call("show_visualization", queryId=query_id), context())
    assert isinstance(outcome, Immediate) and outcome.is_error


async def test_a_bad_visualization_id_is_refused_rather_than_ignored() -> None:
    outcome = await prepare_call(call("show_visualization", queryId=12, visualizationId="31"), context())
    assert isinstance(outcome, Immediate) and outcome.is_error


async def test_opening_a_dashboard_needs_a_real_id() -> None:
    outcome = await prepare_call(call("open_dashboard", dashboardId=4), context())
    assert outcome == ClientCall(call_id="call-1", tool="open_dashboard", args={"dashboardId": 4})
    refused = await prepare_call(call("open_dashboard", dashboardId=False), context())
    assert isinstance(refused, Immediate) and refused.is_error


def test_each_browser_tool_names_the_result_it_expects() -> None:
    assert tools.result_kind_for("run_query") == "query_result"
    assert tools.result_kind_for("list_data_sources") == "data_sources"
    assert tools.result_kind_for("describe_data_source") == "data_source_schema"
    assert tools.result_kind_for("search_library") == "library"
    assert tools.result_kind_for("show_visualization") == "saved_visualization"
    assert tools.result_kind_for("open_dashboard") == "dashboard"
    assert tools.result_kind_for("propose_query") is None
    assert tools.result_kind_for("propose_dashboard") is None
    assert tools.result_kind_for("link_help") is None
    assert tools.result_kind_for("nope") is None


async def test_list_data_sources_goes_to_the_browser_with_no_arguments() -> None:
    outcome = await prepare_call(call("list_data_sources"), context())
    assert outcome == ClientCall(call_id="call-1", tool="list_data_sources", args={})


async def test_describe_data_source_passes_the_id_through() -> None:
    outcome = await prepare_call(call("describe_data_source", dataSourceId=7), context())
    assert outcome == ClientCall(call_id="call-1", tool="describe_data_source", args={"dataSourceId": 7})


async def test_describe_data_source_needs_a_real_id() -> None:
    outcome = await prepare_call(call("describe_data_source", dataSourceId=0), context())
    assert isinstance(outcome, Immediate) and outcome.is_error
