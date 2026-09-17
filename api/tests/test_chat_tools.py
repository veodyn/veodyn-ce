import json
from typing import Any

import pytest

from tests.converse_stubs import SPEEDS
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.services.chat import tools
from veodyn_api.services.chat.prompt import HISTORY_OMITTED, chat_system
from veodyn_api.services.chat.tools import ChatTool, ClientCall, Immediate, ToolContext, prepare_call

pytestmark = pytest.mark.anyio

BOARDINGS = SPEEDS.model_copy(update={"id": "historical.boardings", "name": "Boardings"})
DOCS = SPEEDS.model_copy(update={"id": "1. feeds > params", "name": "Docs"})
GOOD_SQL = "SELECT avg(speed_mph) FROM regional_speeds"


class Drafts:
    def __init__(self) -> None:
        self.saved: list[tuple[str | None, dict[str, Any]]] = []

    async def __call__(self, draft_id: str | None, payload: dict[str, Any]) -> tuple[str, int]:
        self.saved.append((draft_id, payload))
        return draft_id or "draft-1", len(self.saved)


def context(drafts: Drafts | None = None, datasets: tuple[DatasetOut, ...] = (SPEEDS, BOARDINGS, DOCS)) -> ToolContext:
    async def data_source_id() -> int:
        return 5

    return ToolContext(datasets=datasets, data_source_id=data_source_id, save_draft=drafts or Drafts())


def call(tool_name: str, /, **arguments: Any) -> dict[str, Any]:
    return {"type": "tool_use", "id": "call-1", "name": tool_name, "input": arguments}


async def test_run_query_asks_the_browser_to_run_validated_sql() -> None:
    outcome = await prepare_call(
        call("run_query", datasetTable="regional_speeds", sql=f"  {GOOD_SQL};", purpose="average speed"),
        context(),
    )
    assert outcome == ClientCall(
        call_id="call-1",
        tool="run_query",
        args={"dataSourceId": 5, "sql": GOOD_SQL, "purpose": "average speed", "vizChoiceId": "table"},
    )


async def test_a_bare_name_resolves_when_it_is_unambiguous() -> None:
    outcome = await prepare_call(
        call("run_query", datasetTable="boardings", sql="SELECT count() FROM historical.boardings", purpose="x"),
        context(),
    )
    assert isinstance(outcome, ClientCall)


async def test_an_unknown_table_never_reaches_the_browser() -> None:
    outcome = await prepare_call(call("run_query", datasetTable="secrets", sql="SELECT 1 FROM secrets"), context())
    assert isinstance(outcome, Immediate)
    assert outcome.is_error
    assert "regional_speeds" in outcome.content
    assert "historical.boardings" in outcome.content
    assert "feeds > params" not in outcome.content


async def test_a_table_that_is_not_queryable_is_unknown() -> None:
    outcome = await prepare_call(call("run_query", datasetTable="1. feeds > params", sql="SELECT 1"), context())
    assert isinstance(outcome, Immediate) and outcome.is_error


async def test_refused_sql_is_reported_with_its_reason_and_the_second_refusal_says_stop() -> None:
    ctx = context()
    first = await prepare_call(call("run_query", datasetTable="regional_speeds", sql="DROP TABLE x"), ctx)
    second = await prepare_call(call("run_query", datasetTable="regional_speeds", sql="SELECT 1 FROM other"), ctx)
    assert isinstance(first, Immediate) and first.is_error
    assert "DROP" in first.content
    assert "second refusal" not in first.content
    assert isinstance(second, Immediate) and "second refusal" in second.content


async def test_an_unresolvable_warehouse_is_an_error_for_the_model() -> None:
    async def no_warehouse() -> int:
        raise ApiError(ErrorId.WAREHOUSE_SOURCE_UNRESOLVABLE, "there are 2 warehouses", 503)

    ctx = context()
    ctx.data_source_id = no_warehouse
    outcome = await prepare_call(call("run_query", datasetTable="regional_speeds", sql=GOOD_SQL), ctx)
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert "2 warehouses" in outcome.content


async def test_propose_query_saves_a_draft_the_save_hook_can_write() -> None:
    drafts = Drafts()
    outcome = await prepare_call(
        call(
            "propose_query",
            name="Average speed",
            description="The mean speed.",
            datasetTable="regional_speeds",
            sql=GOOD_SQL,
            vizChoiceId="counter",
        ),
        context(drafts),
    )
    payload = {
        "name": "Average speed",
        "description": "The mean speed.",
        "sql": GOOD_SQL,
        "datasetTable": "regional_speeds",
        "vizChoiceId": "counter",
        "vizOptions": {},
    }
    assert drafts.saved == [(None, payload)]
    assert isinstance(outcome, Immediate) and not outcome.is_error
    assert outcome.draft == {"draftId": "draft-1", "version": 1, "kind": "query", "payload": payload}
    assert json.loads(outcome.content)["saved"] is False


async def test_propose_query_revises_the_named_draft_and_defaults_the_name() -> None:
    drafts = Drafts()
    await prepare_call(
        call("propose_query", draftId="d-9", datasetTable="regional_speeds", sql=GOOD_SQL, vizChoiceId="nope"),
        context(drafts),
    )
    [(draft_id, payload)] = drafts.saved
    assert draft_id == "d-9"
    assert payload["name"] == "Regional speeds"
    assert payload["vizChoiceId"] == "table"


async def test_propose_query_refuses_unsafe_sql_without_saving() -> None:
    drafts = Drafts()
    outcome = await prepare_call(
        call("propose_query", name="x", datasetTable="regional_speeds", sql="DELETE FROM regional_speeds"),
        context(drafts),
    )
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert drafts.saved == []


async def test_an_unknown_tool_is_an_error() -> None:
    outcome = await prepare_call(call("drop_everything"), context())
    assert isinstance(outcome, Immediate) and outcome.is_error


async def test_arguments_that_are_not_an_object_are_treated_as_empty() -> None:
    outcome = await prepare_call({"type": "tool_use", "id": "c", "name": "run_query", "input": "oops"}, context())
    assert isinstance(outcome, Immediate) and outcome.is_error


def test_the_registry_lists_every_tool_and_refuses_a_duplicate() -> None:
    assert [one["name"] for one in tools.tool_definitions()] == [
        "run_query",
        "propose_query",
        "search_library",
        "show_visualization",
        "open_dashboard",
    ]
    with pytest.raises(ValueError):
        tools.register_chat_tool(tools.RUN_QUERY)
    with pytest.raises(ValueError):
        tools.register_chat_tool(ChatTool(name="x", definition={"name": "y"}, handler=tools.RUN_QUERY.handler))


def test_the_system_prompt_carries_the_rules_and_the_catalog() -> None:
    blocks = chat_system((SPEEDS,), omitted_history=False)
    text = "\n".join(block["text"] for block in blocks)
    assert "`truncated` is true" in text
    assert "regional_speeds" in text
    assert "speed_mph" in text
    assert "chart-bar" in text
    assert HISTORY_OMITTED not in text
    assert all(block["type"] == "text" for block in blocks)


def test_the_system_prompt_says_when_history_was_omitted_and_when_nothing_is_readable() -> None:
    blocks = chat_system((), omitted_history=True)
    assert blocks[-1]["text"] == HISTORY_OMITTED
    assert "No warehouse tables are available" in blocks[1]["text"]
    assert "existing queries and dashboards" in blocks[1]["text"]


def test_the_rules_send_the_model_to_the_library_first() -> None:
    text = chat_system((SPEEDS,), omitted_history=False)[0]["text"]
    assert "`search_library`" in text
    assert "`show_visualization`" in text
    assert "`open_dashboard`" in text


async def test_a_library_search_goes_to_the_browser_with_both_kinds_by_default() -> None:
    outcome = await prepare_call(call("search_library", text="  bikeshare "), context())
    assert outcome == ClientCall(
        call_id="call-1",
        tool="search_library",
        args={"text": "bikeshare", "kinds": ["query", "dashboard"], "tags": []},
    )


async def test_a_library_search_keeps_known_kinds_and_caps_tags() -> None:
    tags = [f"tag-{index}" for index in range(8)] + ["", 3]
    outcome = await prepare_call(
        call("search_library", text="", kinds=["dashboard", "report", "dashboard"], tags=tags), context()
    )
    assert isinstance(outcome, ClientCall)
    assert outcome.args == {"text": "", "kinds": ["dashboard"], "tags": tags[:5]}


async def test_a_library_search_with_nothing_to_look_for_is_refused() -> None:
    outcome = await prepare_call(call("search_library", text=" ", tags=[""]), context())
    assert isinstance(outcome, Immediate) and outcome.is_error


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
    assert tools.result_kind_for("search_library") == "library"
    assert tools.result_kind_for("show_visualization") == "saved_visualization"
    assert tools.result_kind_for("open_dashboard") == "dashboard"
    assert tools.result_kind_for("propose_query") is None
    assert tools.result_kind_for("nope") is None
