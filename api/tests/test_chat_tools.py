import json
from typing import Any

import pytest

from tests.converse_stubs import SPEEDS
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.services.chat import tools
from veodyn_api.services.chat.prompt import HISTORY_OMITTED, chat_system
from veodyn_api.services.chat.tools import ChatTool, ClientCall, DataSourceInfo, Immediate, ToolContext, prepare_call

pytestmark = pytest.mark.anyio

BOARDINGS = SPEEDS.model_copy(update={"id": "historical.boardings", "name": "Boardings"})
DOCS = SPEEDS.model_copy(update={"id": "1. feeds > params", "name": "Docs"})
GOOD_SQL = "SELECT avg(speed_mph) FROM regional_speeds"


class Drafts:
    def __init__(self) -> None:
        self.saved: list[tuple[str, str | None, dict[str, Any]]] = []

    async def __call__(self, kind: str, draft_id: str | None, payload: dict[str, Any]) -> tuple[str, int]:
        self.saved.append((kind, draft_id, payload))
        return draft_id or "draft-1", len(self.saved)


def context(
    drafts: Drafts | None = None,
    datasets: tuple[DatasetOut, ...] = (SPEEDS, BOARDINGS, DOCS),
    *,
    warehouse_id: int | None = 5,
    known_sources: dict[int, DataSourceInfo] | None = None,
    known_query_drafts: set[str] | None = None,
) -> ToolContext:
    async def data_source_id() -> int:
        if warehouse_id is None:
            raise ApiError(ErrorId.WAREHOUSE_SOURCE_UNRESOLVABLE, "there are 2 warehouses", 503)
        return warehouse_id

    def data_source_info(source_id: int) -> DataSourceInfo | None:
        return (known_sources or {}).get(source_id)

    async def query_draft_exists(draft_id: str) -> bool:
        return draft_id in (known_query_drafts or set())

    return ToolContext(
        datasets=datasets,
        data_source_id=data_source_id,
        data_source_info=data_source_info,
        save_draft=drafts or Drafts(),
        query_draft_exists=query_draft_exists,
    )


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
        "dataSourceId": 5,
        "vizChoiceId": "counter",
        "vizOptions": {},
        "datasetTable": "regional_speeds",
    }
    assert drafts.saved == [("query", None, payload)]
    assert isinstance(outcome, Immediate) and not outcome.is_error
    assert outcome.draft == {"draftId": "draft-1", "version": 1, "kind": "query", "payload": payload}
    assert json.loads(outcome.content)["saved"] is False


async def test_propose_query_revises_the_named_draft_and_defaults_the_name() -> None:
    drafts = Drafts()
    await prepare_call(
        call("propose_query", draftId="d-9", datasetTable="regional_speeds", sql=GOOD_SQL, vizChoiceId="nope"),
        context(drafts),
    )
    [(kind, draft_id, payload)] = drafts.saved
    assert kind == "query"
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
        "list_data_sources",
        "describe_data_source",
        "search_library",
        "show_visualization",
        "open_dashboard",
        "propose_dashboard",
        "link_help",
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
    assert "No warehouse tables are available" in blocks[-2]["text"]
    assert "existing queries and dashboards" in blocks[-2]["text"]


def test_the_rules_send_the_model_to_the_library_first() -> None:
    text = chat_system((SPEEDS,), omitted_history=False)[0]["text"]
    assert "`search_library`" in text
    assert "`show_visualization`" in text
    assert "`open_dashboard`" in text
    assert "`propose_dashboard`" in text


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


SQL_SOURCE = DataSourceInfo(syntax="sql")
JSON_SOURCE = DataSourceInfo(syntax="json", resources={"predictions": ("stop_id",)})
VIEW_ONLY_SOURCE = DataSourceInfo(syntax="sql", view_only=True)
CUSTOM_SOURCE = DataSourceInfo(syntax="custom")


async def test_run_query_against_an_unknown_data_source_is_refused_before_the_browser() -> None:
    outcome = await prepare_call(
        call("run_query", dataSourceId=9, sql="SELECT 1", purpose="x"),
        context(known_sources={}),
    )
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert "list_data_sources" in outcome.content


async def test_run_query_by_id_against_the_warehouse_itself_is_refused() -> None:
    outcome = await prepare_call(
        call("run_query", dataSourceId=5, sql="SELECT 1", purpose="x"),
        context(known_sources={5: SQL_SOURCE}, warehouse_id=5),
    )
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert "datasetTable" in outcome.content


async def test_giving_both_datasettable_and_datasourceid_is_refused() -> None:
    outcome = await prepare_call(
        call("run_query", datasetTable="regional_speeds", dataSourceId=9, sql=GOOD_SQL),
        context(known_sources={9: SQL_SOURCE}),
    )
    assert isinstance(outcome, Immediate) and outcome.is_error


async def test_run_query_against_a_second_sql_source_uses_the_generic_gate() -> None:
    outcome = await prepare_call(
        call("run_query", dataSourceId=9, sql="SELECT * FROM query_1 JOIN query_2 USING (stop_id)", purpose="x"),
        context(known_sources={9: SQL_SOURCE}),
    )
    assert outcome == ClientCall(
        call_id="call-1",
        tool="run_query",
        args={
            "dataSourceId": 9,
            "sql": "SELECT * FROM query_1 JOIN query_2 USING (stop_id)",
            "purpose": "x",
            "vizChoiceId": "table",
        },
    )


async def test_the_generic_gate_still_blocks_dml_and_sqlite_admin_statements() -> None:
    for sql in ("DELETE FROM query_1", "ATTACH DATABASE 'x' AS y", "PRAGMA table_info(query_1)"):
        outcome = await prepare_call(
            call("run_query", dataSourceId=9, sql=sql), context(known_sources={9: SQL_SOURCE})
        )
        assert isinstance(outcome, Immediate) and outcome.is_error, sql


async def test_the_generic_gate_allows_a_comma_join_and_a_table_valued_function() -> None:
    outcome = await prepare_call(
        call("run_query", dataSourceId=9, sql="SELECT * FROM query_1, json_each(query_1.data)", purpose="x"),
        context(known_sources={9: SQL_SOURCE}),
    )
    assert isinstance(outcome, ClientCall)


async def test_run_query_against_a_json_source_sends_a_serialized_resource_call() -> None:
    outcome = await prepare_call(
        call(
            "run_query",
            dataSourceId=7,
            resourceCall={"resource": "predictions", "params": {"stop_id": "80101"}},
            purpose="x",
        ),
        context(known_sources={7: JSON_SOURCE}),
    )
    assert outcome == ClientCall(
        call_id="call-1",
        tool="run_query",
        args={
            "dataSourceId": 7,
            "sql": '{"resource":"predictions","params":{"stop_id":"80101"}}',
            "purpose": "x",
            "vizChoiceId": "table",
        },
    )


async def test_an_unknown_resource_is_refused_with_the_available_names() -> None:
    outcome = await prepare_call(
        call("run_query", dataSourceId=7, resourceCall={"resource": "nope"}), context(known_sources={7: JSON_SOURCE})
    )
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert "predictions" in outcome.content


async def test_an_unexpected_param_is_refused() -> None:
    outcome = await prepare_call(
        call("run_query", dataSourceId=7, resourceCall={"resource": "predictions", "params": {"nope": 1}}),
        context(known_sources={7: JSON_SOURCE}),
    )
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert "nope" in outcome.content


async def test_a_resource_call_needs_the_registry_from_describe_data_source() -> None:
    syntax_only = DataSourceInfo(syntax="json", resources=None)
    outcome = await prepare_call(
        call("run_query", dataSourceId=7, resourceCall={"resource": "predictions"}),
        context(known_sources={7: syntax_only}),
    )
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert "describe_data_source" in outcome.content


async def test_sql_and_resource_call_are_refused_against_the_wrong_kind_of_source() -> None:
    wrong_field_for_sql = await prepare_call(
        call("run_query", dataSourceId=9, resourceCall={"resource": "x"}), context(known_sources={9: SQL_SOURCE})
    )
    wrong_field_for_json = await prepare_call(
        call("run_query", dataSourceId=7, sql="SELECT 1"), context(known_sources={7: JSON_SOURCE})
    )
    assert isinstance(wrong_field_for_sql, Immediate) and wrong_field_for_sql.is_error
    assert isinstance(wrong_field_for_json, Immediate) and wrong_field_for_json.is_error


async def test_a_view_only_source_is_refused_before_the_browser() -> None:
    outcome = await prepare_call(
        call("run_query", dataSourceId=3, sql="SELECT 1"), context(known_sources={3: VIEW_ONLY_SOURCE})
    )
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert "view-only" in outcome.content


async def test_an_unsupported_syntax_is_refused() -> None:
    outcome = await prepare_call(
        call("run_query", dataSourceId=12, sql="SELECT 1"), context(known_sources={12: CUSTOM_SOURCE})
    )
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert outcome.content == tools.CANNOT_QUERY_YET


async def test_propose_query_against_another_data_source_omits_datasettable() -> None:
    drafts = Drafts()
    outcome = await prepare_call(
        call("propose_query", name="Departures", dataSourceId=7, resourceCall={"resource": "predictions"}),
        context(drafts, known_sources={7: JSON_SOURCE}),
    )
    [(kind, _, payload)] = drafts.saved
    assert kind == "query"
    assert payload["dataSourceId"] == 7
    assert "datasetTable" not in payload
    assert payload["sql"] == '{"resource":"predictions","params":{}}'
    assert isinstance(outcome, Immediate) and not outcome.is_error


async def test_propose_dashboard_saves_a_draft_with_mixed_items() -> None:
    drafts = Drafts()
    outcome = await prepare_call(
        call(
            "propose_dashboard",
            name="Bikeshare overview",
            description="Trips and rebalancing.",
            items=[
                {"kind": "draft", "queryDraftId": "d-1", "title": "Trips"},
                {"kind": "existing", "queryId": 12, "visualizationId": 31},
            ],
        ),
        context(drafts, known_query_drafts={"d-1"}),
    )
    payload = {
        "name": "Bikeshare overview",
        "description": "Trips and rebalancing.",
        "items": [
            {"kind": "draft", "queryDraftId": "d-1", "title": "Trips"},
            {"kind": "existing", "queryId": 12, "visualizationId": 31},
        ],
    }
    assert drafts.saved == [("dashboard", None, payload)]
    assert isinstance(outcome, Immediate) and not outcome.is_error
    assert outcome.draft == {"draftId": "draft-1", "version": 1, "kind": "dashboard", "payload": payload}
    assert json.loads(outcome.content)["saved"] is False


async def test_propose_dashboard_revises_the_named_draft() -> None:
    drafts = Drafts()
    await prepare_call(
        call(
            "propose_dashboard",
            draftId="dd-1",
            name="v2",
            items=[{"kind": "existing", "queryId": 1, "visualizationId": 2}],
        ),
        context(drafts),
    )
    [(kind, draft_id, _)] = drafts.saved
    assert kind == "dashboard"
    assert draft_id == "dd-1"


async def test_propose_dashboard_refuses_an_unknown_query_draft() -> None:
    drafts = Drafts()
    outcome = await prepare_call(
        call("propose_dashboard", name="x", items=[{"kind": "draft", "queryDraftId": "nope"}]),
        context(drafts, known_query_drafts={"d-1"}),
    )
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert "queryDraftId" in outcome.content
    assert drafts.saved == []


async def test_propose_dashboard_refuses_an_existing_item_missing_ids() -> None:
    drafts = Drafts()
    outcome = await prepare_call(
        call("propose_dashboard", name="x", items=[{"kind": "existing", "queryId": 1}]),
        context(drafts),
    )
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert drafts.saved == []


async def test_propose_dashboard_refuses_an_unknown_item_kind() -> None:
    outcome = await prepare_call(call("propose_dashboard", name="x", items=[{"kind": "nope"}]), context())
    assert isinstance(outcome, Immediate) and outcome.is_error


async def test_propose_dashboard_needs_at_least_one_item() -> None:
    outcome = await prepare_call(call("propose_dashboard", name="x", items=[]), context())
    assert isinstance(outcome, Immediate) and outcome.is_error


async def test_propose_dashboard_caps_at_twelve_items() -> None:
    items = [{"kind": "existing", "queryId": n, "visualizationId": n} for n in range(1, 14)]
    outcome = await prepare_call(call("propose_dashboard", name="x", items=items), context())
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert "12" in outcome.content


async def test_propose_dashboard_needs_a_name() -> None:
    outcome = await prepare_call(
        call("propose_dashboard", name="  ", items=[{"kind": "existing", "queryId": 1, "visualizationId": 2}]),
        context(),
    )
    assert isinstance(outcome, Immediate) and outcome.is_error
