import pytest

from tests.test_chat_tools import call, context
from veodyn_api.schemas.ai_chat import ChatLibraryResultIn
from veodyn_api.services.chat import tools
from veodyn_api.services.chat.prompt import chat_system
from veodyn_api.services.chat.tools import ClientCall, Immediate, prepare_call

pytestmark = pytest.mark.anyio


async def test_a_search_with_no_text_and_no_tags_browses_the_kind() -> None:
    outcome = await prepare_call(call("search_library", text=" ", kinds=["dashboard"]), context())
    assert outcome == ClientCall(
        call_id="call-1", tool="search_library", args={"text": "", "kinds": ["dashboard"], "tags": []}
    )


async def test_a_search_with_no_text_argument_at_all_browses() -> None:
    outcome = await prepare_call(call("search_library"), context())
    assert isinstance(outcome, ClientCall) and outcome.args["text"] == ""


async def test_searches_past_the_turn_cap_are_refused_with_an_instruction_to_answer() -> None:
    ctx = context()
    for index in range(tools.MAX_LIBRARY_SEARCHES):
        assert isinstance(await prepare_call(call("search_library", text=f"word {index}"), ctx), ClientCall)
    refused = await prepare_call(call("search_library", text="one more"), ctx)
    assert isinstance(refused, Immediate) and refused.is_error
    assert "answer" in refused.content.lower()


async def test_a_refused_search_does_not_count_against_the_cap() -> None:
    ctx = context()
    await prepare_call(call("search_library", text="x", kinds=["report"]), ctx)
    assert ctx.library_searches == 0


def test_the_tool_lets_text_be_left_out_and_explains_more_and_the_counts() -> None:
    definition = tools.SEARCH_LIBRARY.definition
    assert "text" not in definition["input_schema"].get("required", [])
    assert "`more`" in definition["description"]
    assert "tagCounts" in definition["description"]


def test_the_prompt_says_to_browse_and_stop_searching_when_more_is_set() -> None:
    text = chat_system((), omitted_history=False)[0]["text"]
    assert "empty text" in text
    assert "`more`" in text


def test_a_library_result_carries_counts_tag_groups_and_a_full_dashboard_page() -> None:
    items = [{"type": "dashboard", "id": index, "name": f"Board {index}"} for index in range(1, 51)]
    items += [{"type": "query", "id": index, "name": f"Query {index}"} for index in range(1, 11)]
    parsed = ChatLibraryResultIn.model_validate(
        {
            "kind": "library",
            "ok": True,
            "items": items,
            "more": True,
            "queryCount": 204,
            "dashboardCount": 34,
            "tagCounts": [{"kind": "dashboard", "name": "traveler-site", "count": 17}],
        }
    )
    assert parsed.dashboard_count == 34 and parsed.query_count == 204
    assert parsed.tag_counts is not None and parsed.tag_counts[0].count == 17
