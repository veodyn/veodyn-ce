import json

import pytest

from tests.test_chat_tools import Drafts, call, context
from veodyn_api.services.chat.tools import Immediate, prepare_call

pytestmark = pytest.mark.anyio


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
