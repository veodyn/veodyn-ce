from typing import Any, cast

import pytest
from pydantic import TypeAdapter, ValidationError

from tests.chat_route_harness import Harness, headers
from tests.chat_stubs import text_turn, tool_turn
from tests.test_chat_routes import harness, model  # noqa: F401
from veodyn_api.schemas.ai_chat_results import OPEN_RESULT_MAX_BYTES, ChatToolResultIn
from veodyn_api.services.chat import tools
from veodyn_api.services.chat.tools import ChatTool, ClientCall

RESULTS: TypeAdapter[Any] = TypeAdapter(ChatToolResultIn)


@pytest.fixture
def routes(request: pytest.FixtureRequest) -> Harness:
    return cast(Harness, request.getfixturevalue("harness"))


@pytest.fixture
def pack_tool(monkeypatch: pytest.MonkeyPatch) -> str:
    async def handler(call_id: str, arguments: dict[str, Any], ctx: Any) -> ClientCall:
        return ClientCall(call_id=call_id, tool="pack_check_tool", args=arguments)

    definition = {"name": "pack_check_tool", "description": "d", "input_schema": {"type": "object", "properties": {}}}
    tool = ChatTool(name="pack_check_tool", definition=definition, handler=handler, result_kind="pack_check")
    monkeypatch.setitem(tools._TOOLS, "pack_check_tool", tool)
    return "pack_check_tool"


def test_a_pack_result_kind_keeps_its_own_fields() -> None:
    parsed = RESULTS.validate_python({"kind": "pack_check", "ok": True, "kpiId": "otp", "problems": []})
    dumped = parsed.model_dump(by_alias=True, exclude_none=True, mode="json")
    assert dumped == {"kind": "pack_check", "ok": True, "kpiId": "otp", "problems": []}


@pytest.mark.parametrize(
    "result",
    [
        {"ok": True, "kind": "library", "items": [{"type": "alert", "id": 1, "name": "x"}]},
        {"ok": True, "kind": "kpi", "kpi": {"id": "no spaces allowed"}},
        {"ok": True, "kind": "Pack Check"},
        {"ok": True, "kind": "x" * 33},
        {"ok": True, "kind": "pack_check", "error": "x" * 501},
        {"ok": True, "kind": "pack_check", "blob": "x" * (OPEN_RESULT_MAX_BYTES + 1)},
    ],
)
def test_malformed_core_results_and_unbounded_pack_results_are_refused(result: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        RESULTS.validate_python(result)


def test_the_route_accepts_the_pack_result_its_tool_asked_for(routes: Harness, pack_tool: str) -> None:
    routes.model.turns.extend([tool_turn("call-1", pack_tool, {}), text_turn("Checked.")])
    turn = routes.turn(routes.thread())
    request = routes.wait_for(turn, "tool_request")
    assert request["resultKind"] == "pack_check"
    other = {"ok": True, "kind": "other_pack_check"}
    refused = routes.client.post(
        f"/ai/chat/turns/{turn}/tool-results", json={"callId": "call-1", "result": other}, headers=headers()
    )
    assert refused.status_code == 409
    result = {"ok": True, "kind": "pack_check", "kpiId": "otp"}
    accepted = routes.client.post(
        f"/ai/chat/turns/{turn}/tool-results", json={"callId": "call-1", "result": result}, headers=headers()
    )
    assert accepted.status_code == 202, accepted.text
    routes.wait_for(turn, "turn_done")
