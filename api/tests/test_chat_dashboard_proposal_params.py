from typing import Any

import pytest

from tests.test_chat_tools import Drafts, call, context
from veodyn_api.services.chat import tools
from veodyn_api.services.chat.prompt import chat_system
from veodyn_api.services.chat.tools import Immediate, prepare_call

pytestmark = pytest.mark.anyio

LIVE_ROUTE = {"kind": "existing", "queryId": 137, "visualizationId": 240, "title": "Live route"}


async def propose(*items: dict[str, Any], drafts: Drafts | None = None) -> Immediate:
    outcome = await prepare_call(
        call("propose_dashboard", name="Main Terminal & Route 7", items=list(items)),
        context(drafts, known_query_drafts={"d-1"}),
    )
    assert isinstance(outcome, Immediate)
    return outcome


async def test_an_existing_item_keeps_the_parameter_values_the_chat_previewed_with() -> None:
    drafts = Drafts()
    outcome = await propose({**LIVE_ROUTE, "params": {"route": "MT720"}}, drafts=drafts)
    assert not outcome.is_error, outcome.content
    [(_, _, payload)] = drafts.saved
    assert payload["items"] == [{**LIVE_ROUTE, "parameters": {"route": "MT720"}}]


@pytest.mark.parametrize(
    "value",
    [7, ["MT720", "MT020"], {"start": "2026-10-01", "end": "2026-10-25"}],
)
async def test_an_existing_item_takes_every_value_shape_run_saved_query_takes(value: Any) -> None:
    drafts = Drafts()
    outcome = await propose({**LIVE_ROUTE, "params": {"p": value}}, drafts=drafts)
    assert not outcome.is_error, outcome.content
    assert drafts.saved[0][2]["items"][0]["parameters"] == {"p": value}


async def test_an_existing_item_without_params_carries_no_parameters() -> None:
    drafts = Drafts()
    await propose(LIVE_ROUTE, drafts=drafts)
    assert "parameters" not in drafts.saved[0][2]["items"][0]


@pytest.mark.parametrize(
    "params",
    ["MT720", {"route": {"nested": True}}, {"route": True}, {"": "MT720"}, {"route": "x" * 501}],
)
async def test_an_existing_item_refuses_params_run_saved_query_would_refuse(params: Any) -> None:
    drafts = Drafts()
    outcome = await propose({**LIVE_ROUTE, "params": params}, drafts=drafts)
    assert outcome.is_error
    assert "params" in outcome.content
    assert drafts.saved == []


@pytest.mark.parametrize(
    "item",
    [
        {"kind": "draft", "queryDraftId": "d-1", "params": {"route": "MT720"}},
        {"kind": "text", "text": "Notes", "params": {"route": "MT720"}},
    ],
)
async def test_params_belong_to_existing_items_only(item: dict[str, Any]) -> None:
    drafts = Drafts()
    outcome = await propose(item, drafts=drafts)
    assert outcome.is_error
    assert "params" in outcome.content
    assert drafts.saved == []


def definition_of(name: str) -> dict[str, Any]:
    [definition] = [one for one in tools.tool_definitions() if one["name"] == name]
    return definition


def test_the_tool_schema_offers_params_on_an_item() -> None:
    definition = definition_of("propose_dashboard")
    item = definition["input_schema"]["properties"]["items"]["items"]["properties"]
    assert item["params"]["type"] == "object"
    assert "run_saved_query" in item["params"]["description"]
    assert "params" in definition["description"]


def test_adding_to_a_saved_dashboard_says_to_pin_the_previewed_values() -> None:
    description = definition_of("update_dashboard")["description"]
    assert "static-value" in description
    assert "run_saved_query" in description


def test_the_prompt_tells_the_model_to_carry_previewed_values_onto_the_dashboard() -> None:
    text = chat_system((), omitted_history=False)[0]["text"]
    rule = next(line for line in text.split("\n- ") if line.startswith("To build a dashboard"))
    assert "`run_saved_query`" in rule
    assert "same `params`" in rule
