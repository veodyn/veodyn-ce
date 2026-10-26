from typing import Any

import pytest

from tests.catalog_stubs import SPEEDS
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.services.chat import tools
from veodyn_api.services.chat.prompt import HISTORY_OMITTED, chat_system
from veodyn_api.services.chat.tools import ChatTool, DataSourceInfo, Immediate, ToolContext, prepare_call

pytestmark = pytest.mark.anyio

BOARDINGS = SPEEDS.model_copy(update={"id": "historical.boardings", "name": "Boardings"})
DOCS = SPEEDS.model_copy(update={"id": "1. feeds > params", "name": "Docs"})
GOOD_SQL = "SELECT avg(speed_mph) FROM regional_speeds"


class Drafts:
    def __init__(self) -> None:
        self.saved: list[tuple[str, str | None, dict[str, Any]]] = []

    async def __call__(self, kind: str, draft_id: str | None, payload: dict[str, Any]) -> tuple[str, int]:
        self.saved.append((kind, draft_id, payload))
        return draft_id or "draft-1", len(self.saved)


def context(
    drafts: Drafts | None = None,
    datasets: tuple[DatasetOut, ...] = (SPEEDS, BOARDINGS, DOCS),
    *,
    warehouse_id: int | None = 5,
    known_sources: dict[int, DataSourceInfo] | None = None,
    known_query_drafts: set[str] | None = None,
) -> ToolContext:
    async def data_source_id() -> int:
        if warehouse_id is None:
            raise ApiError(ErrorId.WAREHOUSE_SOURCE_UNRESOLVABLE, "there are 2 warehouses", 503)
        return warehouse_id

    def data_source_info(source_id: int) -> DataSourceInfo | None:
        return (known_sources or {}).get(source_id)

    async def query_draft_exists(draft_id: str) -> bool:
        return draft_id in (known_query_drafts or set())

    return ToolContext(
        datasets=datasets,
        data_source_id=data_source_id,
        data_source_info=data_source_info,
        save_draft=drafts or Drafts(),
        query_draft_exists=query_draft_exists,
    )


def call(tool_name: str, /, **arguments: Any) -> dict[str, Any]:
    if tool_name in ("run_query", "propose_query"):
        arguments = {"vizChoiceId": "table", **arguments}
    return {"type": "tool_use", "id": "call-1", "name": tool_name, "input": arguments}


async def test_an_unknown_tool_is_an_error() -> None:
    outcome = await prepare_call(call("drop_everything"), context())
    assert isinstance(outcome, Immediate) and outcome.is_error


async def test_arguments_that_are_not_an_object_are_treated_as_empty() -> None:
    outcome = await prepare_call({"type": "tool_use", "id": "c", "name": "run_query", "input": "oops"}, context())
    assert isinstance(outcome, Immediate) and outcome.is_error


def test_the_registry_lists_every_tool_and_refuses_a_duplicate() -> None:
    assert [one["name"] for one in tools.tool_definitions()] == [
        "run_query",
        "propose_query",
        "list_data_sources",
        "describe_data_source",
        "search_library",
        "show_visualization",
        "open_dashboard",
        "propose_dashboard",
        "link_help",
        "run_saved_query",
        "open_query",
        "update_query",
        "describe_visualization_type",
        "propose_visualization",
        "update_visualization",
        "delete_visualization",
        "update_dashboard",
        "fork_query",
        "archive_query",
        "archive_dashboard",
        "set_favorite",
        "share_dashboard",
        "share_visualization",
        "download_result",
    ]
    with pytest.raises(ValueError):
        tools.register_chat_tool(tools.RUN_QUERY)
    with pytest.raises(ValueError):
        tools.register_chat_tool(ChatTool(name="x", definition={"name": "y"}, handler=tools.RUN_QUERY.handler))


def test_the_system_prompt_carries_the_rules_and_the_catalog() -> None:
    blocks = chat_system((SPEEDS,), omitted_history=False)
    text = "\n".join(block["text"] for block in blocks)
    assert "`truncated` is true" in text
    assert "regional_speeds" in text
    assert "speed_mph" in text
    assert "chart-bar" in text
    assert HISTORY_OMITTED not in text
    assert all(block["type"] == "text" for block in blocks)


def test_the_system_prompt_says_when_history_was_omitted_and_when_nothing_is_readable() -> None:
    blocks = chat_system((), omitted_history=True)
    assert blocks[-1]["text"] == HISTORY_OMITTED
    assert "No warehouse tables are available" in blocks[-2]["text"]
    assert "existing queries and dashboards" in blocks[-2]["text"]


def test_the_rules_send_the_model_to_the_library_first() -> None:
    text = chat_system((SPEEDS,), omitted_history=False)[0]["text"]
    assert "`search_library`" in text
    assert "`show_visualization`" in text
    assert "`open_dashboard`" in text
    assert "`propose_dashboard`" in text
