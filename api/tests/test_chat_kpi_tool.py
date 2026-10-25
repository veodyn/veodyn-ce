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

KPI = {
    "name": "On-time rate",
    "valueColumn": "rate",
    "sourceQueryId": 12,
    "target": 90,
    "direction": "higher-is-better",
    "cadence": "daily",
}


def kpi_args(**extra: Any) -> dict[str, Any]:
    merged = {**KPI, **extra}
    return {key: value for key, value in merged.items() if value is not None}


def expected_args(**extra: Any) -> dict[str, Any]:
    base = {
        "name": "On-time rate",
        "description": "",
        "sourceQueryId": 12,
        "queryDraftId": None,
        "valueColumn": "rate",
        "unit": None,
        "target": 90.0,
        "direction": "higher-is-better",
        "cadence": "daily",
        "atRisk": None,
        "breached": None,
    }
    return {**base, **extra}


async def test_propose_kpi_asks_the_browser_to_check_the_query() -> None:
    outcome = await prepare_call(call("propose_kpi", **kpi_args()), pack_context())
    assert outcome == ClientCall(call_id="call-1", tool="propose_kpi", args=expected_args())
    assert result_kind_for("propose_kpi") == "kpi_check"


async def test_propose_kpi_is_a_pack_proposal() -> None:
    tool = tool_named("propose_kpi")
    assert tool is not None and tool.requires_pack and tool.proposal


async def test_zero_is_a_target() -> None:
    outcome = await prepare_call(call("propose_kpi", **kpi_args(target=0)), pack_context())
    assert isinstance(outcome, ClientCall) and outcome.args["target"] == 0.0


async def test_a_query_draft_can_be_the_source() -> None:
    ctx = pack_context(known_query_drafts={"qd-1"})
    outcome = await prepare_call(call("propose_kpi", **kpi_args(sourceQueryId=None, queryDraftId="qd-1")), ctx)
    assert isinstance(outcome, ClientCall)
    assert outcome.args["queryDraftId"] == "qd-1" and outcome.args["sourceQueryId"] is None


async def test_an_unknown_query_draft_is_refused() -> None:
    outcome = await prepare_call(
        call("propose_kpi", **kpi_args(sourceQueryId=None, queryDraftId="nope")), pack_context()
    )
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert "queryDraftId" in outcome.content


async def test_both_sources_or_neither_is_refused() -> None:
    ctx = pack_context(known_query_drafts={"qd-1"})
    both = await prepare_call(call("propose_kpi", **kpi_args(queryDraftId="qd-1")), ctx)
    neither = await prepare_call(call("propose_kpi", **kpi_args(sourceQueryId=None)), ctx)
    for outcome in (both, neither):
        assert isinstance(outcome, Immediate) and outcome.is_error
        assert "sourceQueryId" in outcome.content


@pytest.mark.parametrize(
    ("changes", "field"),
    [
        ({"name": ""}, "name"),
        ({"name": None}, "name"),
        ({"valueColumn": ""}, "valueColumn"),
        ({"valueColumn": None}, "valueColumn"),
        ({"target": None}, "target"),
        ({"target": True}, "target"),
        ({"target": "ninety"}, "target"),
        ({"direction": "sideways"}, "direction"),
        ({"direction": None}, "direction"),
        ({"cadence": "monthly"}, "cadence"),
        ({"cadence": None}, "cadence"),
        ({"sourceQueryId": 0}, "sourceQueryId"),
        ({"sourceQueryId": True}, "sourceQueryId"),
    ],
)
async def test_propose_kpi_refuses_bad_fields(changes: dict[str, Any], field: str) -> None:
    arguments = {**KPI, **changes}
    arguments = {key: value for key, value in arguments.items() if value is not None}
    outcome = await prepare_call(call("propose_kpi", **arguments), pack_context())
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert field in outcome.content


@pytest.mark.parametrize(
    ("direction", "at_risk", "breached", "kept"),
    [
        ("higher-is-better", 80, 60, True),
        ("higher-is-better", 80, 80, True),
        ("higher-is-better", 60, 80, False),
        ("lower-is-better", 5, 10, True),
        ("lower-is-better", 10, 5, False),
        ("higher-is-better", 80, None, False),
        ("higher-is-better", None, 60, False),
    ],
)
async def test_bands_are_both_or_neither_and_ordered_for_the_direction(
    direction: str, at_risk: Any, breached: Any, kept: bool
) -> None:
    outcome = await prepare_call(
        call("propose_kpi", **kpi_args(direction=direction, atRisk=at_risk, breached=breached)), pack_context()
    )
    assert isinstance(outcome, ClientCall)
    if kept:
        assert (outcome.args["atRisk"], outcome.args["breached"]) == (float(at_risk), float(breached))
    else:
        assert (outcome.args["atRisk"], outcome.args["breached"]) == (None, None)


async def test_a_bool_is_not_a_band() -> None:
    outcome = await prepare_call(call("propose_kpi", **kpi_args(atRisk=True, breached=False)), pack_context())
    assert isinstance(outcome, ClientCall)
    assert (outcome.args["atRisk"], outcome.args["breached"]) == (None, None)


def kpi_check(**extra: Any) -> dict[str, Any]:
    return {
        "ok": True,
        "kind": "kpi_check",
        "sourceQueryId": 12,
        "queryName": "On-time",
        "columns": ["day", "rate"],
        **extra,
    }


def kpi_request(**extra: Any) -> ClientCall:
    return ClientCall(call_id="call-1", tool="propose_kpi", args=expected_args(**extra))


async def test_a_confirmed_kpi_becomes_a_draft() -> None:
    drafts = Drafts()
    completer = completer_for("propose_kpi")
    assert completer is not None
    done = await completer(kpi_request(unit="%"), kpi_check(), pack_context(drafts))
    assert not done.is_error
    payload = {**expected_args(unit="%"), "sourceQueryName": "On-time"}
    assert drafts.saved == [("kpi", None, payload)]
    assert done.draft == {"draftId": "draft-1", "version": 1, "kind": "kpi", "payload": payload}


async def test_a_column_the_query_does_not_return_is_refused_with_the_columns() -> None:
    drafts = Drafts()
    completer = completer_for("propose_kpi")
    assert completer is not None
    done = await completer(kpi_request(valueColumn="ontime"), kpi_check(), pack_context(drafts))
    assert done.is_error
    assert "ontime" in done.content and "day, rate" in done.content
    assert drafts.saved == []


async def test_unknown_columns_do_not_block_the_kpi() -> None:
    drafts = Drafts()
    completer = completer_for("propose_kpi")
    assert completer is not None
    done = await completer(kpi_request(), kpi_check(columns=[]), pack_context(drafts))
    assert not done.is_error
    assert drafts.saved[0][0] == "kpi"


async def test_a_draft_source_is_confirmed_by_draft_id() -> None:
    drafts = Drafts()
    completer = completer_for("propose_kpi")
    assert completer is not None
    request = kpi_request(sourceQueryId=None, queryDraftId="qd-1")
    result = kpi_check(sourceQueryId=None, queryDraftId="qd-1")
    done = await completer(request, result, pack_context(drafts))
    assert not done.is_error
    assert drafts.saved[0][2]["queryDraftId"] == "qd-1"


@pytest.mark.parametrize(
    "result",
    [
        kpi_check(sourceQueryId=99),
        kpi_check(sourceQueryId=None),
        {"ok": True, "kind": "kpi_check", "queryName": "x", "columns": ["rate"]},
    ],
)
async def test_a_check_for_another_query_is_refused(result: dict[str, Any]) -> None:
    drafts = Drafts()
    completer = completer_for("propose_kpi")
    assert completer is not None
    done = await completer(kpi_request(), result, pack_context(drafts))
    assert done.is_error
    assert drafts.saved == []
