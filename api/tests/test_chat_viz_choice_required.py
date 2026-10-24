from typing import Any

import pytest

from tests.test_chat_tools import GOOD_SQL, context
from veodyn_api.services.chat.tools import ClientCall, Immediate, prepare_call
from veodyn_api.services.chat.turn_context import MAP_QUESTION_RULE

pytestmark = pytest.mark.anyio


def bare(tool_name: str, **arguments: Any) -> dict[str, Any]:
    return {"type": "tool_use", "id": "call-1", "name": tool_name, "input": arguments}


@pytest.mark.parametrize("missing", [{}, {"vizChoiceId": ""}, {"vizChoiceId": "   "}, {"vizChoiceId": None}])
async def test_run_query_without_a_viz_choice_is_refused_with_the_choices(missing: dict[str, Any]) -> None:
    outcome = await prepare_call(
        bare("run_query", datasetTable="regional_speeds", sql=GOOD_SQL, purpose="x", **missing), context()
    )
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert "vizChoiceId" in outcome.content and "table" in outcome.content


async def test_propose_query_without_a_viz_choice_is_refused() -> None:
    outcome = await prepare_call(
        bare("propose_query", name="Speeds", datasetTable="regional_speeds", sql=GOOD_SQL), context()
    )
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert "vizChoiceId" in outcome.content


async def test_run_query_with_a_viz_choice_still_goes_to_the_browser() -> None:
    outcome = await prepare_call(
        bare("run_query", datasetTable="regional_speeds", sql=GOOD_SQL, purpose="x", vizChoiceId="map"), context()
    )
    assert isinstance(outcome, ClientCall) and outcome.args["vizChoiceId"] == "map"


def test_map_question_rule_says_to_draw_with_a_choice_on_the_picked_provider() -> None:
    assert "vizChoiceId" in MAP_QUESTION_RULE
