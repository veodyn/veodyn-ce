import pytest

from tests.test_chat_tools import GOOD_SQL, Drafts, call, context
from veodyn_api.services.chat import tools
from veodyn_api.services.chat.tools import ClientCall, DataSourceInfo, Immediate, prepare_call

pytestmark = pytest.mark.anyio


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
