import json
from typing import Any

import pytest
from pydantic import TypeAdapter

from tests.chat_operation_cases import (
    ACCEPTED_ANSWERS,
    DASHBOARD,
    HANDLER_CASES,
    LATER,
    QUERY,
    REFUSED_ANSWERS,
    REFUSED_ARGUMENTS,
    VISUALIZATION,
    check,
    request,
)
from tests.test_chat_tools import Drafts, call, context
from veodyn_api.schemas.ai_chat_results import ChatToolResultIn
from veodyn_api.services.chat.prompt import CHAT_RULES
from veodyn_api.services.chat.tools import (
    ClientCall,
    Immediate,
    completer_for,
    prepare_call,
    result_kind_for,
    tool_named,
)

pytestmark = pytest.mark.anyio

OPERATION_TOOLS = (
    "fork_query",
    "archive_query",
    "archive_dashboard",
    "set_favorite",
    "share_dashboard",
    "share_visualization",
)
RESULT: TypeAdapter[Any] = TypeAdapter(ChatToolResultIn)


@pytest.mark.parametrize(("tool", "given", "expected"), HANDLER_CASES)
async def test_each_handler_asks_the_browser_with_its_ids(
    tool: str, given: dict[str, Any], expected: dict[str, Any]
) -> None:
    outcome = await prepare_call(call(tool, **given), context())
    assert outcome == ClientCall(call_id="call-1", tool=tool, args=expected)


@pytest.mark.parametrize(("tool", "given", "word"), REFUSED_ARGUMENTS)
async def test_handlers_refuse_bad_arguments(tool: str, given: dict[str, Any], word: str) -> None:
    outcome = await prepare_call(call(tool, **given), context())
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert word in outcome.content


@pytest.mark.parametrize("refresh", [0, 30, 60, 300, 900])
async def test_every_refresh_cadence_is_accepted(refresh: int) -> None:
    outcome = await prepare_call(
        call("share_visualization", queryId=7, visualizationId=31, action="create", refreshSeconds=refresh), context()
    )
    assert isinstance(outcome, ClientCall) and outcome.args["refreshSeconds"] == refresh


@pytest.mark.parametrize("name", OPERATION_TOOLS)
def test_the_operation_tools_are_offered_everywhere_as_proposals_with_a_check_result(name: str) -> None:
    tool = tool_named(name)
    assert tool is not None and tool.proposal
    assert not tool.requires_pack and tool.requires_feature is None
    assert result_kind_for(name) == "operation_check"
    assert completer_for(name) is not None


def test_download_is_a_read_with_its_own_result_kind() -> None:
    tool = tool_named("download_result")
    assert tool is not None and not tool.proposal and tool.complete is None
    assert result_kind_for("download_result") == "download"


async def test_a_fork_check_saves_an_operation_draft() -> None:
    drafts = Drafts()
    completer = completer_for("fork_query")
    assert completer is not None
    result = {**check("fork", QUERY), "params": {"name": "Copy of (#7) Weekly revenue"}}
    done = await completer(request("fork_query", queryId=7), result, context(drafts))
    assert not done.is_error
    payload = {
        "op": "fork",
        "target": QUERY,
        "params": {"name": "Copy of (#7) Weekly revenue"},
        "destructive": False,
    }
    assert drafts.saved == [("operation", None, payload)]
    assert json.loads(done.content) == {"draftId": "draft-1", "version": 1, "destructive": False}
    assert done.draft == {"draftId": "draft-1", "version": 1, "kind": "operation", "payload": payload}


async def test_an_archive_check_is_destructive_and_keeps_its_snapshot() -> None:
    drafts = Drafts()
    completer = completer_for("archive_query")
    assert completer is not None
    result = check("archive", QUERY, snapshot={"updatedAt": "2026-10-24T09:00:00+00:00"})
    done = await completer(request("archive_query", queryId=7, restore=False), result, context(drafts))
    assert not done.is_error
    assert json.loads(done.content)["destructive"] is True
    assert drafts.saved[0][2]["snapshot"] == {"updatedAt": "2026-10-24T09:00:00+00:00"}
    assert drafts.saved[0][2]["destructive"] is True


@pytest.mark.parametrize(("tool", "args", "op", "target"), ACCEPTED_ANSWERS)
async def test_the_completer_accepts_the_matching_op_and_target(
    tool: str, args: dict[str, Any], op: str, target: dict[str, Any]
) -> None:
    drafts = Drafts()
    completer = completer_for(tool)
    assert completer is not None
    done = await completer(request(tool, **args), check(op, target), context(drafts))
    assert not done.is_error, done.content
    assert drafts.saved[0][0] == "operation"
    assert drafts.saved[0][2]["destructive"] is (op in ("archive", "revoke"))


@pytest.mark.parametrize(("tool", "args", "result"), REFUSED_ANSWERS)
async def test_the_completer_refuses_an_answer_for_another_request(
    tool: str, args: dict[str, Any], result: dict[str, Any]
) -> None:
    drafts = Drafts()
    completer = completer_for(tool)
    assert completer is not None
    done = await completer(request(tool, **args), result, context(drafts))
    assert done.is_error
    assert drafts.saved == []


async def test_the_completer_refuses_problems_and_saves_nothing() -> None:
    drafts = Drafts()
    completer = completer_for("archive_query")
    assert completer is not None
    result = check("archive", QUERY, problems=["only the owner or an admin can archive this query"])
    done = await completer(request("archive_query", queryId=7, restore=False), result, context(drafts))
    assert done.is_error and "only the owner or an admin can archive this query" in done.content
    assert drafts.saved == []


async def test_the_completer_refuses_a_destructive_flag_that_disagrees_with_the_op() -> None:
    drafts = Drafts()
    completer = completer_for("archive_query")
    assert completer is not None
    understated = {**check("archive", QUERY), "destructive": False}
    done = await completer(request("archive_query", queryId=7, restore=False), understated, context(drafts))
    assert done.is_error and "destructive" in done.content
    overstated = {**check("restore", QUERY), "destructive": True}
    again = await completer(request("archive_query", queryId=7, restore=True), overstated, context(drafts))
    assert again.is_error and drafts.saved == []


async def test_the_completer_refuses_a_share_whose_params_drift_from_the_request() -> None:
    drafts = Drafts()
    completer = completer_for("share_visualization")
    assert completer is not None
    asked = request(
        "share_visualization", queryId=7, visualizationId=31, action="create", expiresAt=None, refreshSeconds=60
    )
    drifted = {**check("share", VISUALIZATION), "params": {"refreshSeconds": 900}}
    assert (await completer(asked, drifted, context(drafts))).is_error
    matching = {**check("share", VISUALIZATION), "params": {"refreshSeconds": 60}}
    assert not (await completer(asked, matching, context(drafts))).is_error
    dashboard_completer = completer_for("share_dashboard")
    assert dashboard_completer is not None
    dashboard_asked = request("share_dashboard", dashboardId=3, action="create", expiresAt=LATER)
    wrong = {**check("share", DASHBOARD), "params": {"expiresAt": "2027-01-01T00:00:00Z"}}
    assert (await dashboard_completer(dashboard_asked, wrong, context(drafts))).is_error
    right = {**check("share", DASHBOARD), "params": {"expiresAt": LATER}}
    assert not (await dashboard_completer(dashboard_asked, right, context(drafts))).is_error


def test_the_result_union_reads_an_operation_check() -> None:
    parsed = RESULT.validate_python(check("archive", QUERY, snapshot={"updatedAt": "x"}))
    assert parsed.kind == "operation_check"
    refusal = RESULT.validate_python({"ok": False, "kind": "operation_check", "error": "no"})
    assert refusal.error == "no"


def test_the_result_union_reads_a_download() -> None:
    good = {"ok": True, "kind": "download", "queryId": 7, "format": "csv", "href": "/api/node/queries/7/results.csv"}
    assert RESULT.validate_python(good).kind == "download"
    for broken in (
        {**good, "format": "pdf"},
        {**good, "href": "https://evil.example/a"},
        {**good, "href": "/api/node/queries/8/results.csv"},
        {**good, "href": "/api/node/queries/7/results.xlsx"},
    ):
        with pytest.raises(ValueError):
            RESULT.validate_python(broken)


async def test_a_library_search_passes_archived_through() -> None:
    plain = await prepare_call(call("search_library", text="x"), context())
    assert isinstance(plain, ClientCall) and plain.args["archived"] is False
    archived = await prepare_call(call("search_library", text="x", archived=True), context())
    assert isinstance(archived, ClientCall) and archived.args["archived"] is True
    junk = await prepare_call(call("search_library", text="x", archived="yes"), context())
    assert isinstance(junk, Immediate) and junk.is_error and "archived" in junk.content


def test_a_library_item_may_say_it_is_archived() -> None:
    parsed = RESULT.validate_python(
        {"ok": True, "kind": "library", "items": [{"type": "query", "id": 7, "name": "Q", "archived": True}]}
    )
    assert parsed.items[0].archived is True


def test_the_prompt_tells_the_model_about_confirmations_and_downloads() -> None:
    assert "confirms twice" in CHAT_RULES
    assert "does not attach data" in CHAT_RULES
