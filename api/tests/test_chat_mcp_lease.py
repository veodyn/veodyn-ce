import uuid
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from tests.mcp_stubs import PROPOSE, Mcp, mcp
from tests.test_chat_routes import harness, headers, model
from veodyn_api.models.ai_chat import AiChatTurn
from veodyn_api.services.chat import store
from veodyn_api.services.chat.bus import TurnBus

__all__ = ["harness", "mcp", "model"]


def lease_key(turn_id: uuid.UUID) -> str:
    return f"chat:turn:{turn_id}:lease"


def test_an_mcp_turn_holds_its_lease_until_it_is_finished(mcp: Mcp, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, Any] = {}
    real = store.finish_turn

    def observed(db: Session, turn_id: uuid.UUID, **kwargs: Any) -> None:
        turn = db.get(AiChatTurn, turn_id)
        assert turn is not None
        thread = str(turn.thread_id)
        seen["lease"] = mcp.harness.redis.exists(lease_key(turn_id))
        seen["detail"] = mcp.thread(thread)["turns"][0]["status"]
        seen["post"] = mcp.client.post(
            f"/ai/chat/threads/{thread}/turns", json={"text": "hi"}, headers=headers()
        ).status_code
        seen["turn"] = turn_id
        real(db, turn_id, **kwargs)

    monkeypatch.setattr(store, "finish_turn", observed)
    done = mcp.call("propose_query", PROPOSE)
    assert seen["lease"] == 1
    assert seen["detail"] == "running"
    assert seen["post"] == 409
    assert mcp.thread(done["draft"]["threadId"])["turns"][0]["status"] == "done"
    assert mcp.harness.redis.exists(lease_key(seen["turn"])) == 0


def test_an_mcp_turn_that_cannot_take_its_lease_fails_with_503(
    mcp: Mcp, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def refused(self: TurnBus, turn_id: str) -> None:
        raise OSError("redis is down")

    monkeypatch.setattr(TurnBus, "hold_lease", refused)
    mcp.call("propose_query", PROPOSE, expect=503)
    assert [row.status for row in db.scalars(select(AiChatTurn))] == ["failed"]


def test_an_mcp_turn_that_errors_after_opening_releases_its_lease(
    mcp: Mcp, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(db: Session, turn_id: uuid.UUID, **kwargs: Any) -> None:
        raise RuntimeError("database went away")

    monkeypatch.setattr(store, "finish_turn", broken)
    mcp.call("propose_query", PROPOSE, expect=500)
    [turn] = list(db.scalars(select(AiChatTurn)))
    assert turn.status == "failed"
    assert mcp.harness.redis.exists(lease_key(turn.id)) == 0
