import json

import pytest

from tests.test_chat_tools import GOOD_SQL, Drafts, call, context
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.services.chat.tools import ClientCall, Immediate, prepare_call

pytestmark = pytest.mark.anyio


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
