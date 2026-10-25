import json
from typing import Any

import pytest

from tests.catalog_stubs import SPEEDS
from veodyn_api.schemas.ai_chat_context import ChatDataSourceEntryIn
from veodyn_api.services.chat.data_source_facts import resolve_source_info
from veodyn_api.services.chat.tools import ClientCall, Immediate, ToolContext, prepare_call

pytestmark = pytest.mark.anyio

SQL_SOURCE = ChatDataSourceEntryIn(id=9, name="Ops", type="pg", syntax="sql", view_only=False)
JSON_SOURCE = ChatDataSourceEntryIn(
    id=8, name="Traffic feed", type="traffic_feed", syntax="json", view_only=False, resources=["incidents"]
)
VIEW_ONLY = ChatDataSourceEntryIn(id=19, name="Shared results", type="results", syntax="sql", view_only=True)
INVENTORY = (SQL_SOURCE, JSON_SOURCE, VIEW_ONLY)


def result_message(payload: dict[str, Any], call_id: str = "t1") -> list[dict[str, Any]]:
    return [
        {"role": "assistant", "content": [{"type": "tool_use", "id": call_id, "name": "x", "input": {}}]},
        {
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": call_id, "content": json.dumps(payload)}],
        },
    ]


def listing(*sources: dict[str, Any], ok: bool = True) -> list[dict[str, Any]]:
    return result_message({"ok": ok, "kind": "data_sources", "sources": list(sources)})


def listed(source_id: int, view_only: bool, syntax: str = "sql") -> dict[str, Any]:
    return {"id": source_id, "name": "n", "type": "t", "syntax": syntax, "viewOnly": view_only}


def test_inventory_answers_syntax_without_list_call() -> None:
    info = resolve_source_info(9, INVENTORY, [])
    assert info is not None
    assert info.syntax == "sql"
    assert info.view_only is False
    assert info.resources is None


def test_a_source_in_neither_inventory_nor_transcript_is_unknown() -> None:
    assert resolve_source_info(404, INVENTORY, []) is None
    assert resolve_source_info(9, None, []) is None


def test_refresh_overrides_inventory_view_only() -> None:
    transcript = listing(listed(9, True))
    info = resolve_source_info(9, INVENTORY, transcript)
    assert info is not None and info.view_only is True


def test_the_latest_refresh_wins() -> None:
    later = result_message({"ok": True, "kind": "data_sources", "sources": [listed(9, False)]}, "t2")
    transcript = [*listing(listed(9, True)), *later]
    info = resolve_source_info(9, INVENTORY, transcript)
    assert info is not None and info.view_only is False


def test_a_failed_refresh_does_not_override_the_inventory() -> None:
    info = resolve_source_info(9, INVENTORY, listing(listed(9, True), ok=False))
    assert info is not None and info.view_only is False


def test_source_absent_from_refresh_is_gone() -> None:
    assert resolve_source_info(9, INVENTORY, listing(listed(8, False, "json"))) is None


def test_refresh_makes_a_source_known_that_the_inventory_lacked() -> None:
    info = resolve_source_info(30, INVENTORY, listing(listed(30, False)))
    assert info is not None and info.syntax == "sql"


def test_resources_come_only_from_a_describe_result() -> None:
    assert resolve_source_info(8, INVENTORY, [])
    inventory_only = resolve_source_info(8, INVENTORY, [])
    assert inventory_only is not None and inventory_only.resources is None
    described = result_message(
        {
            "ok": True,
            "kind": "data_source_schema",
            "dataSourceId": 8,
            "syntax": "json",
            "resources": [{"name": "incidents", "params": ["region"], "returns": []}],
        }
    )
    info = resolve_source_info(8, INVENTORY, described)
    assert info is not None and info.resources == {"incidents": ("region",)}


def context(inventory: tuple[ChatDataSourceEntryIn, ...] | None, transcript: list[dict[str, Any]]) -> ToolContext:
    async def data_source_id() -> int:
        return 5

    async def draft_exists(draft_id: str) -> bool:
        return False

    async def save_draft(kind: str, draft_id: str | None, payload: dict[str, Any]) -> tuple[str, int]:
        return "d", 1

    return ToolContext(
        datasets=(SPEEDS,),
        data_source_id=data_source_id,
        data_source_info=lambda source_id: resolve_source_info(source_id, inventory, transcript),
        save_draft=save_draft,
        query_draft_exists=draft_exists,
    )


def run_call(**arguments: Any) -> dict[str, Any]:
    return {"type": "tool_use", "id": "call-1", "name": "run_query", "input": arguments}


async def test_run_query_on_inventoried_source_needs_no_list_call() -> None:
    outcome = await prepare_call(
        run_call(dataSourceId=9, sql="SELECT 1", purpose="x", vizChoiceId="table"), context(INVENTORY, [])
    )
    assert isinstance(outcome, ClientCall)
    assert outcome.args["dataSourceId"] == 9


async def test_run_query_on_a_view_only_inventoried_source_is_refused_before_the_browser() -> None:
    outcome = await prepare_call(
        run_call(dataSourceId=19, sql="SELECT 1", purpose="x", vizChoiceId="table"), context(INVENTORY, [])
    )
    assert isinstance(outcome, Immediate)
    assert "view-only" in outcome.content


async def test_inventory_resource_names_do_not_satisfy_resource_call() -> None:
    outcome = await prepare_call(
        run_call(
            dataSourceId=8,
            resourceCall={"resource": "incidents", "params": {}},
            purpose="x",
            vizChoiceId="table",
        ),
        context(INVENTORY, []),
    )
    assert isinstance(outcome, Immediate)
    assert "describe_data_source" in outcome.content


def describe(resources: list[dict[str, Any]], call_id: str) -> list[dict[str, Any]]:
    return result_message(
        {"ok": True, "kind": "data_source_schema", "dataSourceId": 8, "syntax": "json", "resources": resources},
        call_id,
    )


async def test_a_later_describe_with_no_resources_clears_earlier_names() -> None:
    transcript = [
        *describe([{"name": "incidents", "params": [], "returns": []}], "t1"),
        *describe([], "t2"),
    ]
    info = resolve_source_info(8, INVENTORY, transcript)
    assert info is not None and info.resources == {}
    outcome = await prepare_call(
        run_call(
            dataSourceId=8,
            resourceCall={"resource": "incidents", "params": {}},
            purpose="x",
            vizChoiceId="table",
        ),
        context(INVENTORY, transcript),
    )
    assert isinstance(outcome, Immediate) and outcome.is_error
