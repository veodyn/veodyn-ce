import asyncio
import json
from typing import Any

import pytest
from sqlalchemy.orm import Session

from tests.catalog_stubs import SPEEDS
from tests.chat_stubs import ScriptedChatModel, text_turn, tool_turn
from tests.test_chat_runner import RUN, bus, new_turn, sessions
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.schemas.ai_chat_context import ChatDataSourceEntryIn
from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.services.chat.bus import TurnBus
from veodyn_api.services.chat.runner import TurnRunner
from veodyn_api.services.chat.turn_context import EMPTY_CONTEXT, TurnContext

pytestmark = pytest.mark.anyio

__all__ = ["bus", "sessions"]

TABLES = "Tables you may read"


def inventory(*ids: int) -> TurnContext:
    sources = tuple(
        ChatDataSourceEntryIn(id=one, name=f"Source {one}", type="pg", syntax="sql", view_only=False) for one in ids
    )
    return TurnContext(instance=None, data_sources=sources, ready_queries=())


async def system_texts(
    db: Session, bus: TurnBus, sessions: Any, context: TurnContext, warehouse: int | None = 5
) -> list[str]:
    async def datasets() -> tuple[DatasetOut, ...]:
        return (SPEEDS,)

    async def data_source_id() -> int:
        if warehouse is None:
            raise ApiError(ErrorId.WAREHOUSE_SOURCE_UNRESOLVABLE, "there are 2 warehouses", 503)
        return warehouse

    turn = new_turn(db)
    model = ScriptedChatModel(text_turn("ok"))
    runner = TurnRunner(model=model, bus=bus, sessions=sessions, datasets=datasets, data_source_id=data_source_id)
    await runner.run(turn.id, turn.thread_id, 1, turn.user_text, context=context)
    return [block["text"] for block in model.calls[0]["system"]]


async def test_catalog_hidden_without_warehouse_in_inventory(db: Session, bus: TurnBus, sessions: Any) -> None:
    texts = await system_texts(db, bus, sessions, inventory(1, 2))
    assert not any(TABLES in text for text in texts)
    assert any("No warehouse tables are available" in text for text in texts)


async def test_catalog_shown_with_warehouse_in_inventory(db: Session, bus: TurnBus, sessions: Any) -> None:
    texts = await system_texts(db, bus, sessions, inventory(1, 5))
    assert any(TABLES in text and "regional_speeds" in text for text in texts)


async def test_catalog_hidden_with_null_inventory(db: Session, bus: TurnBus, sessions: Any) -> None:
    texts = await system_texts(db, bus, sessions, EMPTY_CONTEXT)
    assert not any(TABLES in text for text in texts)


async def test_catalog_hidden_with_an_empty_inventory(db: Session, bus: TurnBus, sessions: Any) -> None:
    texts = await system_texts(db, bus, sessions, TurnContext(instance=None, data_sources=(), ready_queries=()))
    assert not any(TABLES in text for text in texts)


async def test_catalog_hidden_when_the_warehouse_cannot_be_resolved(db: Session, bus: TurnBus, sessions: Any) -> None:
    texts = await system_texts(db, bus, sessions, inventory(1, 5), warehouse=None)
    assert not any(TABLES in text for text in texts)


async def test_a_run_query_against_a_hidden_catalog_names_no_tables(db: Session, bus: TurnBus, sessions: Any) -> None:
    turn = new_turn(db)

    async def datasets() -> tuple[DatasetOut, ...]:
        return (SPEEDS,)

    async def data_source_id() -> int:
        return 5

    model = ScriptedChatModel(tool_turn("call-1", "run_query", RUN), text_turn("I cannot read that."))
    runner = TurnRunner(model=model, bus=bus, sessions=sessions, datasets=datasets, data_source_id=data_source_id)

    await asyncio.wait_for(runner.run(turn.id, turn.thread_id, 1, turn.user_text, context=inventory(1)), 10)

    refusal = model.calls[1]["messages"][2]["content"][0]
    assert refusal["is_error"] is True
    assert refusal["content"].endswith("The tables you may read are: none")
    assert "regional_speeds" not in json.dumps(model.calls[1]["system"])
