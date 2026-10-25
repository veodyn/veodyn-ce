import uuid
from collections.abc import Iterator

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session, sessionmaker

from tests.chat_stubs import TOKEN_SECRET, sign
from tests.conftest import REDASH_TEST_URL, upgrade_to
from tests.migration_chains import ce_config
from tests.test_chat_routes import RELAY_KEY, Harness, harness, headers, model
from veodyn_api.main import create_app
from veodyn_api.services.chat import store

__all__ = ["harness", "model"]

OWNER = "7"
RECEIPT = {"step": 0, "outcome": "done", "targetId": "7", "updatedAt": "2026-10-24T10:00:00.123456+00:00"}
PENDING = {"version": 1, "targetType": "query", "status": "pending"}


def draft_in(harness: Harness, db: Session) -> tuple[str, str]:
    thread_id = harness.thread()
    thread = store.thread_for_owner(db, OWNER, uuid.UUID(thread_id))
    turn, _ = store.start_turn(db, thread, "propose")
    draft_id, _ = store.save_draft(db, thread.id, turn.id, None, "query", {"name": "q"})
    return thread_id, str(draft_id)


def pending_promotion(harness: Harness, draft: str) -> dict[str, str]:
    created = harness.client.post(f"/ai/chat/drafts/{draft}/promotions", json=PENDING, headers=headers())
    assert created.status_code == 201, created.text
    body: dict[str, str] = created.json()
    return body


def test_pending_promotion_without_target(harness: Harness, db: Session) -> None:
    _, draft = draft_in(harness, db)
    response = harness.client.post(f"/ai/chat/drafts/{draft}/promotions", json=PENDING, headers=headers())
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["targetId"] is None
    assert body["status"] == "pending"
    assert body["receipts"] == []


@pytest.mark.parametrize("status", ["done", "partial"])
def test_done_requires_target(harness: Harness, db: Session, status: str) -> None:
    _, draft = draft_in(harness, db)
    response = harness.client.post(
        f"/ai/chat/drafts/{draft}/promotions",
        json={"version": 1, "targetType": "query", "status": status},
        headers=headers(),
    )
    assert response.status_code == 422


def test_patch_records_receipts_and_target(harness: Harness, db: Session) -> None:
    _, draft = draft_in(harness, db)
    created = pending_promotion(harness, draft)
    patched = harness.client.patch(
        f"/ai/chat/drafts/{draft}/promotions/{created['id']}",
        json={"status": "done", "targetId": "7", "receipts": [RECEIPT]},
        headers=headers(),
    )
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["id"] == created["id"]
    assert body["status"] == "done"
    assert body["targetId"] == "7"
    assert body["receipts"] == [{**RECEIPT, "error": None}]
    assert body["updatedAt"] > created["updatedAt"]


def test_patch_sets_the_target_version_at_promote(harness: Harness, db: Session) -> None:
    thread, draft = draft_in(harness, db)
    created = pending_promotion(harness, draft)
    patched = harness.client.patch(
        f"/ai/chat/drafts/{draft}/promotions/{created['id']}",
        json={"status": "done", "targetId": "9", "targetVersionAtPromote": 4},
        headers=headers(),
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["targetVersionAtPromote"] == 4
    detail = harness.client.get(f"/ai/chat/threads/{thread}", headers=headers()).json()
    assert detail["drafts"][0]["promotions"][0]["targetVersionAtPromote"] == 4
    untouched = harness.client.patch(
        f"/ai/chat/drafts/{draft}/promotions/{created['id']}", json={"status": "done"}, headers=headers()
    )
    assert untouched.json()["targetVersionAtPromote"] == 4
    refused = harness.client.patch(
        f"/ai/chat/drafts/{draft}/promotions/{created['id']}", json={"targetVersionAtPromote": -1}, headers=headers()
    )
    assert refused.status_code == 422


def test_patch_to_done_without_any_target_is_refused(harness: Harness, db: Session) -> None:
    _, draft = draft_in(harness, db)
    created = pending_promotion(harness, draft)
    refused = harness.client.patch(
        f"/ai/chat/drafts/{draft}/promotions/{created['id']}", json={"status": "done"}, headers=headers()
    )
    assert refused.status_code == 422


def test_patch_other_owner_404(harness: Harness, db: Session) -> None:
    _, draft = draft_in(harness, db)
    created = pending_promotion(harness, draft)
    stranger = harness.client.patch(
        f"/ai/chat/drafts/{draft}/promotions/{created['id']}", json={"status": "failed"}, headers=headers("8")
    )
    assert stranger.status_code == 404
    missing = harness.client.patch(
        f"/ai/chat/drafts/{draft}/promotions/{uuid.uuid4()}", json={"status": "failed"}, headers=headers()
    )
    assert missing.status_code == 404


def test_patch_cannot_reach_a_promotion_through_another_draft(harness: Harness, db: Session) -> None:
    _, draft = draft_in(harness, db)
    _, other = draft_in(harness, db)
    created = pending_promotion(harness, draft)
    crossed = harness.client.patch(
        f"/ai/chat/drafts/{other}/promotions/{created['id']}", json={"status": "failed"}, headers=headers()
    )
    assert crossed.status_code == 404


def test_legacy_body_defaults_done(harness: Harness, db: Session) -> None:
    _, draft = draft_in(harness, db)
    response = harness.client.post(
        f"/ai/chat/drafts/{draft}/promotions",
        json={"version": 1, "targetType": "query", "targetId": "44", "targetVersionAtPromote": 2},
        headers=headers(),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "done"
    assert body["receipts"] == []
    assert body["targetId"] == "44"


def test_thread_detail_carries_the_lifecycle_fields(harness: Harness, db: Session) -> None:
    thread, draft = draft_in(harness, db)
    pending_promotion(harness, draft)
    detail = harness.client.get(f"/ai/chat/threads/{thread}", headers=headers()).json()
    [promotion] = detail["drafts"][0]["promotions"]
    assert (promotion["status"], promotion["targetId"], promotion["receipts"]) == ("pending", None, [])


@pytest.fixture
def populated_0018(alembic_engine_at_0018: Engine) -> tuple[Engine, str]:
    thread, turn, draft = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with alembic_engine_at_0018.begin() as conn:
        conn.execute(text("INSERT INTO ai_chat_thread (id, owner_subject) VALUES (:id, '7')"), {"id": thread})
        conn.execute(
            text(
                "INSERT INTO ai_chat_turn (id, thread_id, seq, status, user_text) "
                "VALUES (:id, :thread, 1, 'done', 'hi')"
            ),
            {"id": turn, "thread": thread},
        )
        conn.execute(
            text("INSERT INTO ai_chat_draft (id, thread_id, kind) VALUES (:id, :thread, 'query')"),
            {"id": draft, "thread": thread},
        )
        conn.execute(
            text(
                "INSERT INTO ai_chat_draft_version (draft_id, version, turn_id, payload) "
                'VALUES (:draft, 1, :turn, \'{"name": "q"}\')'
            ),
            {"draft": draft, "turn": turn},
        )
        conn.execute(
            text(
                "INSERT INTO ai_chat_draft_promotion (id, draft_id, target_type, target_id, promoted_version) "
                "VALUES (:id, :draft, 'query', '12', 1)"
            ),
            {"id": uuid.uuid4(), "draft": draft},
        )
    return alembic_engine_at_0018, str(thread)


def test_migration_upgrades_populated_0018(
    populated_0018: tuple[Engine, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    engine, thread = populated_0018
    upgrade_to(engine, "head")

    monkeypatch.setenv("VEODYN_REDASH_URL", REDASH_TEST_URL)
    monkeypatch.setenv("VEODYN_AI_RELAY_KEY", RELAY_KEY)
    monkeypatch.setenv("VEODYN_AI_API_KEY", "model-key")
    monkeypatch.setenv("VEODYN_AI_TOKEN_SECRET", TOKEN_SECRET)
    from veodyn_api.db import get_db
    from veodyn_api.settings import get_settings

    get_settings.cache_clear()
    app = create_app()
    sessions = sessionmaker(bind=engine, expire_on_commit=False)

    def override_db() -> Iterator[Session]:
        with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get(
            f"/ai/chat/threads/{thread}",
            headers={"authorization": f"Bearer {RELAY_KEY}", "x-veodyn-user-token": sign(OWNER)},
        )
    assert response.status_code == 200, response.text
    [promotion] = response.json()["drafts"][0]["promotions"]
    assert (promotion["status"], promotion["targetId"], promotion["receipts"]) == ("done", "12", [])
    with engine.connect() as conn:
        assert conn.execute(text("SELECT applied_reported_at FROM ai_chat_thread")).scalar() is None


def test_downgrade_names_the_promotions_it_cannot_represent(populated_0018: tuple[Engine, str]) -> None:
    engine, _ = populated_0018
    upgrade_to(engine, "head")
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO ai_chat_draft_promotion (id, draft_id, target_type, target_id, status, promoted_version) "
                "SELECT :id, draft_id, 'query', NULL, 'pending', 1 FROM ai_chat_draft_promotion LIMIT 1"
            ),
            {"id": uuid.uuid4()},
        )

    with pytest.raises(RuntimeError, match="1 ai_chat_draft_promotion row"):
        command.downgrade(ce_config(), "0018")
