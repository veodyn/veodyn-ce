import pytest

from tests.test_chat_tools import call, context
from veodyn_api.services.chat import tools
from veodyn_api.services.chat.prompt import chat_system
from veodyn_api.services.chat.tools import ClientCall, prepare_call

pytestmark = pytest.mark.anyio


async def test_a_recent_sort_goes_to_the_browser() -> None:
    outcome = await prepare_call(call("search_library", kinds=["query"], sort="recent"), context())
    assert isinstance(outcome, ClientCall) and outcome.args["sort"] == "recent"


@pytest.mark.parametrize("asked", [None, "newest", 3])
async def test_any_other_sort_falls_back_to_match(asked: object) -> None:
    outcome = await prepare_call(call("search_library", text="speeds", sort=asked), context())
    assert isinstance(outcome, ClientCall) and outcome.args["sort"] == "match"


def test_the_tool_offers_a_recent_sort_for_what_changed_lately() -> None:
    sort = tools.SEARCH_LIBRARY.definition["input_schema"]["properties"]["sort"]
    assert sort["enum"] == ["match", "recent"]
    assert "updatedAt" in tools.SEARCH_LIBRARY.definition["description"]


def test_the_prompt_says_to_answer_what_changed_with_a_recent_sort() -> None:
    text = chat_system((), omitted_history=False)[0]["text"]
    assert '`sort: "recent"`' in text
