import json
from typing import Any

import pytest

from tests.chat_pack_stubs import pack_context
from tests.test_chat_tools import Drafts, call
from veodyn_api.services.chat.tools import Immediate, prepare_call, tool_named

pytestmark = pytest.mark.anyio

REPORT_SECTIONS = [
    {"title": "Trips", "intent": "Show weekly trips", "sourceQueryId": 4},
    {"title": "Narrative", "intent": "Explain the trend"},
    {"title": "Speed", "intent": "Speed by region", "queryDraftId": "qd-1", "suggested": True},
]


async def test_propose_report_saves_an_immediate_draft() -> None:
    drafts = Drafts()
    outcome = await prepare_call(
        call("propose_report", goal="Weekly ridership", title="Ridership", sections=REPORT_SECTIONS),
        pack_context(drafts, known_query_drafts={"qd-1"}),
    )
    assert isinstance(outcome, Immediate) and not outcome.is_error
    payload = {
        "goal": "Weekly ridership",
        "title": "Ridership",
        "sections": [
            {
                "title": "Trips",
                "intent": "Show weekly trips",
                "sourceQueryId": 4,
                "queryDraftId": None,
                "suggested": False,
            },
            {
                "title": "Narrative",
                "intent": "Explain the trend",
                "sourceQueryId": None,
                "queryDraftId": None,
                "suggested": False,
            },
            {
                "title": "Speed",
                "intent": "Speed by region",
                "sourceQueryId": None,
                "queryDraftId": "qd-1",
                "suggested": True,
            },
        ],
    }
    assert drafts.saved == [("report", None, payload)]
    assert outcome.draft == {"draftId": "draft-1", "version": 1, "kind": "report", "payload": payload}
    assert json.loads(outcome.content)["saved"] is False
    tool = tool_named("propose_report")
    assert tool is not None and tool.requires_pack and tool.proposal


async def test_a_report_title_defaults_to_the_goal() -> None:
    drafts = Drafts()
    outcome = await prepare_call(
        call("propose_report", goal="Weekly ridership", sections=REPORT_SECTIONS[1:2]), pack_context(drafts)
    )
    assert isinstance(outcome, Immediate) and not outcome.is_error
    assert drafts.saved[0][2]["title"] == "Weekly ridership"


def sections_of(count: int) -> list[dict[str, Any]]:
    return [{"title": f"S{n}", "intent": "i"} for n in range(count)]


@pytest.mark.parametrize(
    ("arguments", "field"),
    [
        ({"goal": "", "sections": sections_of(1)}, "goal"),
        ({"goal": "g"}, "sections"),
        ({"goal": "g", "sections": []}, "sections"),
        ({"goal": "g", "sections": sections_of(21)}, "sections"),
        ({"goal": "g", "sections": "x"}, "sections"),
        ({"goal": "g", "sections": ["x"]}, "section"),
        ({"goal": "g", "sections": [{"title": "", "intent": "i"}]}, "title"),
        ({"goal": "g", "sections": [{"title": "t", "intent": ""}]}, "intent"),
        ({"goal": "g", "sections": [{"title": "t", "intent": "i", "sourceQueryId": 0}]}, "sourceQueryId"),
        ({"goal": "g", "sections": [{"title": "t", "intent": "i", "sourceQueryId": True}]}, "sourceQueryId"),
        ({"goal": "g", "sections": [{"title": "t", "intent": "i", "queryDraftId": "nope"}]}, "queryDraftId"),
        (
            {"goal": "g", "sections": [{"title": "t", "intent": "i", "sourceQueryId": 4, "queryDraftId": "qd-1"}]},
            "one query",
        ),
    ],
)
async def test_propose_report_refuses_bad_input(arguments: dict[str, Any], field: str) -> None:
    drafts = Drafts()
    outcome = await prepare_call(
        call("propose_report", **arguments), pack_context(drafts, known_query_drafts={"qd-1"})
    )
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert field in outcome.content
    assert drafts.saved == []


async def test_twenty_sections_are_allowed() -> None:
    outcome = await prepare_call(call("propose_report", goal="g", sections=sections_of(20)), pack_context())
    assert isinstance(outcome, Immediate) and not outcome.is_error


async def test_propose_message_saves_an_immediate_draft() -> None:
    drafts = Drafts()
    outcome = await prepare_call(
        call("propose_message", title="Detour", header="Route 4 detour", description="Route 4 is detoured."),
        pack_context(drafts),
    )
    assert isinstance(outcome, Immediate) and not outcome.is_error
    payload = {"title": "Detour", "header": "Route 4 detour", "description": "Route 4 is detoured."}
    assert drafts.saved == [("message", None, payload)]
    assert outcome.draft == {"draftId": "draft-1", "version": 1, "kind": "message", "payload": payload}
    tool = tool_named("propose_message")
    assert tool is not None and tool.requires_pack and tool.proposal


async def test_a_message_title_defaults_to_the_header() -> None:
    drafts = Drafts()
    await prepare_call(call("propose_message", header="Route 4 detour", description="d"), pack_context(drafts))
    assert drafts.saved[0][2]["title"] == "Route 4 detour"


@pytest.mark.parametrize(
    ("arguments", "field"),
    [
        ({"description": "d"}, "header"),
        ({"header": "  ", "description": "d"}, "header"),
        ({"header": "h" * 501, "description": "d"}, "header"),
        ({"header": "h"}, "description"),
        ({"header": "h", "description": "d" * 4_001}, "description"),
        ({"header": "h", "description": "d", "title": "t" * 256}, "title"),
    ],
)
async def test_propose_message_refuses_bad_input(arguments: dict[str, Any], field: str) -> None:
    drafts = Drafts()
    outcome = await prepare_call(call("propose_message", **arguments), pack_context(drafts))
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert field in outcome.content
    assert drafts.saved == []
