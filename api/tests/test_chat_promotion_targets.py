from collections.abc import Iterator

import pytest
from sqlalchemy.orm import Session

from tests.test_chat_promotion_lifecycle import draft_in, harness, model
from tests.test_chat_routes import Harness, headers
from veodyn_api.services.chat import promotion_targets
from veodyn_api.services.chat.promotion_targets import (
    is_promotion_target,
    promotion_target_names,
    register_promotion_target,
)

__all__ = ["harness", "model"]


@pytest.fixture
def registry(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(promotion_targets, "_TARGETS", set(promotion_targets._TARGETS))
    yield


def post(harness: Harness, db: Session, target_type: str) -> int:
    _, draft = draft_in(harness, db)
    response = harness.client.post(
        f"/ai/chat/drafts/{draft}/promotions",
        json={"version": 1, "targetType": target_type, "targetId": "3"},
        headers=headers(),
    )
    return response.status_code


def test_community_registers_query_dashboard_and_snippet() -> None:
    assert promotion_target_names() == ("dashboard", "query", "snippet")


def test_a_pack_registers_its_own_targets(registry: None) -> None:
    assert not is_promotion_target("kpi")
    for name in ("kpi", "report", "message"):
        register_promotion_target(name)
    assert {"kpi", "report", "message"} <= set(promotion_target_names())
    assert is_promotion_target("kpi")


def test_registering_twice_is_harmless(registry: None) -> None:
    register_promotion_target("kpi")
    register_promotion_target("kpi")
    assert promotion_target_names().count("kpi") == 1


@pytest.mark.parametrize("name", ["", "  ", "x" * 65])
def test_a_target_name_must_be_a_short_name(registry: None, name: str) -> None:
    with pytest.raises(ValueError):
        register_promotion_target(name)


@pytest.mark.parametrize("target_type", ["query", "dashboard", "snippet"])
def test_a_community_target_is_accepted(harness: Harness, db: Session, target_type: str) -> None:
    assert post(harness, db, target_type) == 201


def test_an_unregistered_target_is_refused(harness: Harness, db: Session) -> None:
    assert post(harness, db, "kpi") == 422


def test_a_registered_pack_target_is_accepted(harness: Harness, db: Session, registry: None) -> None:
    register_promotion_target("kpi")
    assert post(harness, db, "kpi") == 201
