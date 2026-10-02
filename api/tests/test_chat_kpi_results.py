import json
from collections.abc import Iterator
from typing import Any

import pytest
from pydantic import TypeAdapter, ValidationError

from tests.chat_stubs import text_turn, tool_turn
from tests.test_chat_routes import Harness, harness, headers, model
from veodyn_api.schemas.ai_chat import ChatToolResultIn
from veodyn_api.services.chat import tools
from veodyn_api.services.chat.tools import ChatTool, ClientCall, Immediate, ToolContext, register_chat_tool

__all__ = ["harness", "model"]

RESULT = TypeAdapter(ChatToolResultIn)

KPI = {
    "ok": True,
    "kind": "kpi",
    "kpi": {
        "id": "otp-weekly",
        "name": "On-time performance",
        "description": "Share of trips within five minutes of schedule.",
        "domain": "transit",
        "unit": "%",
        "cadence": "weekly",
        "owner": "Dana",
        "target": {"value": 90, "direction": "higher-is-better"},
        "thresholds": {"atRisk": 88, "breached": 85},
    },
    "evaluation": {"value": 81.0, "status": "breached", "delta": -4.5, "asOf": "2026-09-18T06:00:00Z", "stale": False},
    "history": [
        {"at": "2026-09-11T06:00:00Z", "value": 85.5, "status": "at-risk"},
        {"at": "2026-09-18T06:00:00Z", "value": 81.0, "status": "breached"},
    ],
    "retrievedAt": "2026-09-19T12:00:00Z",
}

KPI_LIST = {
    "ok": True,
    "kind": "kpi_list",
    "items": [
        {"id": "otp-weekly", "name": "On-time performance", "unit": "%", "value": 81.0, "status": "breached"},
        {"id": "ridership", "name": "Ridership", "status": "no-data"},
    ],
    "more": False,
}


async def _show_kpi(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    return ClientCall(call_id, "show_kpi", {"kpiId": str(arguments.get("kpiId"))})


@pytest.fixture
def show_kpi() -> Iterator[None]:
    register_chat_tool(
        ChatTool(
            name="show_kpi",
            definition={"name": "show_kpi", "description": "Show a KPI.", "input_schema": {"type": "object"}},
            handler=_show_kpi,
            result_kind="kpi",
        )
    )
    yield
    tools._TOOLS.pop("show_kpi")


def test_the_two_kpi_results_are_accepted() -> None:
    assert RESULT.validate_python(KPI).kind == "kpi"
    assert RESULT.validate_python(KPI_LIST).kind == "kpi_list"
    assert RESULT.validate_python({"ok": False, "kind": "kpi", "error": "No KPI has that id."}).kind == "kpi"


@pytest.mark.parametrize(
    "result",
    [
        {**KPI, "history": [KPI["history"][0]] * 201},
        {**KPI, "kpi": {**KPI["kpi"], "id": "transit/otp"}},
        {**KPI, "evaluation": {**KPI["evaluation"], "status": "fine"}},
        {**KPI, "kpi": {**KPI["kpi"], "target": {"value": 90, "direction": "sideways"}}},
        {**KPI_LIST, "items": [KPI_LIST["items"][1]] * 51},
    ],
)
def test_a_malformed_kpi_result_is_refused(result: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        RESULT.validate_python(result)


def test_a_contributed_kpi_tool_round_trips_through_the_routes(harness: Harness, show_kpi: None) -> None:
    harness.model.turns.extend(
        [tool_turn("call-1", "show_kpi", {"kpiId": "otp-weekly"}), text_turn("On-time performance is breached.")]
    )
    turn = harness.turn(harness.thread())
    request = harness.wait_for(turn, "tool_request")
    assert request == {"callId": "call-1", "tool": "show_kpi", "args": {"kpiId": "otp-weekly"}}
    refused = harness.client.post(
        f"/ai/chat/turns/{turn}/tool-results", json={"callId": "call-1", "result": KPI_LIST}, headers=headers()
    )
    assert refused.status_code == 409
    accepted = harness.client.post(
        f"/ai/chat/turns/{turn}/tool-results", json={"callId": "call-1", "result": KPI}, headers=headers()
    )
    assert accepted.status_code == 202, accepted.text
    harness.wait_for(turn, "turn_done")
    sent = json.loads(harness.model.calls[1]["messages"][2]["content"][0]["content"])
    assert sent["evaluation"] == KPI["evaluation"]
    assert sent["kpi"]["thresholds"] == {"atRisk": 88.0, "breached": 85.0}
    assert len(sent["history"]) == 2
