import uuid
from typing import Any, cast

import pytest
from sqlalchemy import Engine, text

from tests.test_chat_routes import Harness, harness, headers, model  # noqa: F401
from veodyn_api.schemas.ai_chat_context import ChatSubjectDetailIn, ChatTurnIn
from veodyn_api.services.chat.prompt import CHAT_RULES, chat_system
from veodyn_api.services.chat.turn_context import EMPTY_CONTEXT, TurnContext, context_from, subject_block

SUBJECTS: list[dict[str, Any]] = [
    {"kind": "query", "queryId": 5},
    {"kind": "visualization", "queryId": 5, "visualizationId": 9},
    {"kind": "dashboard", "dashboardId": 3},
    {"kind": "widget", "dashboardId": 3, "widgetId": 11},
    {"kind": "dataset", "datasetId": "regional_speeds"},
    {"kind": "new", "newKind": "dashboard"},
    {"kind": "new", "newKind": "kpi"},
    {"kind": "new", "newKind": "report"},
    {"kind": "new", "newKind": "message"},
]

REFUSED: list[dict[str, Any]] = [
    {"kind": "query"},
    {"kind": "visualization", "queryId": 5},
    {"kind": "dashboard"},
    {"kind": "widget", "dashboardId": 3},
    {"kind": "dataset"},
    {"kind": "new"},
    {"kind": "new", "newKind": "folder"},
    {"kind": "query", "queryId": 0},
    {"kind": "query", "queryId": 5, "extra": 1},
    {"kind": "dataset", "datasetId": "x" * 201},
    {"kind": "folder", "queryId": 5},
]


def detail(**overrides: Any) -> ChatSubjectDetailIn:
    base: dict[str, Any] = {
        "kind": "query",
        "id": "5",
        "name": "Weekly revenue",
        "canEdit": True,
        "lines": ["data source 2", "sql: select 1"],
    }
    return ChatSubjectDetailIn.model_validate({**base, **overrides})


@pytest.fixture
def chat(request: pytest.FixtureRequest) -> Harness:
    return cast(Harness, request.getfixturevalue("harness"))


def with_detail(value: ChatSubjectDetailIn | None) -> TurnContext:
    return TurnContext(instance=None, data_sources=None, ready_queries=(), subject_detail=value)


@pytest.mark.parametrize("subject", SUBJECTS)
def test_a_thread_is_created_with_each_subject_kind(chat: Harness, subject: dict[str, Any]) -> None:
    response = chat.client.post("/ai/chat/threads", json={"subject": subject}, headers=headers())
    assert response.status_code == 201, response.text
    assert response.json()["subject"] == subject
    assert response.json()["title"] == ""
    listed = chat.client.get("/ai/chat/threads", headers=headers()).json()["threads"]
    assert listed[0]["subject"] == subject


@pytest.mark.parametrize("subject", REFUSED)
def test_an_incomplete_or_unknown_subject_is_refused(chat: Harness, subject: dict[str, Any]) -> None:
    response = chat.client.post("/ai/chat/threads", json={"subject": subject}, headers=headers())
    assert response.status_code == 422


def test_an_unknown_body_key_is_refused(chat: Harness) -> None:
    response = chat.client.post("/ai/chat/threads", json={"subject": None, "other": 1}, headers=headers())
    assert response.status_code == 422


def test_a_thread_without_a_subject_behaves_as_before(chat: Harness) -> None:
    bare = chat.client.post("/ai/chat/threads", headers=headers())
    empty = chat.client.post("/ai/chat/threads", json={}, headers=headers())
    nulled = chat.client.post("/ai/chat/threads", json={"subject": None}, headers=headers())
    for response in (bare, empty, nulled):
        assert response.status_code == 201
        assert response.json()["subject"] is None
        assert response.json()["title"] == ""
    thread_id = bare.json()["id"]
    assert chat.client.get(f"/ai/chat/threads/{thread_id}/subject", headers=headers()).json() == {"subject": None}


def test_the_subject_route_returns_the_subject_to_its_owner_only(chat: Harness) -> None:
    subject = {"kind": "dashboard", "dashboardId": 3}
    thread_id = chat.client.post("/ai/chat/threads", json={"subject": subject}, headers=headers()).json()["id"]
    own = chat.client.get(f"/ai/chat/threads/{thread_id}/subject", headers=headers())
    assert own.status_code == 200 and own.json() == {"subject": subject}
    assert chat.client.get(f"/ai/chat/threads/{thread_id}/subject", headers=headers("8")).status_code == 404
    assert chat.client.get(f"/ai/chat/threads/{uuid.uuid4()}/subject", headers=headers()).status_code == 404


def test_the_thread_detail_carries_the_subject(chat: Harness) -> None:
    subject = {"kind": "query", "queryId": 5}
    thread_id = chat.client.post("/ai/chat/threads", json={"subject": subject}, headers=headers()).json()["id"]
    body = chat.client.get(f"/ai/chat/threads/{thread_id}", headers=headers()).json()
    assert body["thread"]["subject"] == subject


def test_the_query_block_text_is_exact() -> None:
    assert subject_block(with_detail(detail())) == (
        'This conversation was opened from query 5 "Weekly revenue" (the analyst can edit it):\n'
        "- data source 2\n"
        "- sql: select 1"
    )


def test_the_block_omits_the_edit_note_unless_the_analyst_can_edit() -> None:
    for can_edit in (False, None):
        block = subject_block(with_detail(detail(canEdit=can_edit)))
        assert block is not None and block.startswith('This conversation was opened from query 5 "Weekly revenue":\n')


def test_the_new_block_text_is_exact() -> None:
    new = detail(kind="new", id="dashboard", name="dashboard", canEdit=None, lines=[])
    assert subject_block(with_detail(new)) == "The analyst opened this conversation to create a new dashboard."


def test_there_is_no_block_without_a_detail() -> None:
    assert subject_block(EMPTY_CONTEXT) is None
    assert context_from(ChatTurnIn(text="hi")).subject_detail is None


def test_a_turn_payload_carries_the_detail_into_the_context() -> None:
    payload = ChatTurnIn.model_validate(
        {"text": "hi", "subjectDetail": {"kind": "query", "id": "5", "name": "N", "canEdit": None, "lines": []}}
    )
    assert context_from(payload).subject_detail is not None


@pytest.mark.parametrize(
    "overrides",
    [{"id": "x" * 65}, {"name": "x" * 501}, {"lines": ["a"] * 41}, {"lines": ["x" * 501]}, {"kind": "folder"}],
)
def test_the_detail_limits_are_enforced(overrides: dict[str, Any]) -> None:
    with pytest.raises(ValueError):
        detail(**overrides)


def system_text(context: TurnContext) -> str:
    return "\n".join(block["text"] for block in chat_system((), omitted_history=False, context=context))


def test_the_subject_block_precedes_the_inventory_block() -> None:
    from tests.test_chat_turn_context_prompt import source

    context = TurnContext(instance=None, data_sources=(source(),), ready_queries=(), subject_detail=detail())
    system = system_text(context)
    opened = system.index("This conversation was opened from query 5")
    assert 0 < opened < system.index("Traffic feed")
    assert "opened from" not in system_text(EMPTY_CONTEXT)


def test_the_active_objects_rule_replaces_the_dashboard_line() -> None:
    rule = (
        "The object of each kind most recently opened, created, or named as this conversation's subject is the one "
        '"it" or "this" refers to; for a dashboard, add to it rather than making a new one unless asked.'
    )
    assert rule in " ".join(CHAT_RULES.split())
    assert "has been opened or created earlier in the thread" not in CHAT_RULES
    assert CHAT_RULES.count("most recently opened") == 1


def test_migration_0021_upgrade_downgrade(alembic_engine_at_0020: Engine) -> None:
    from alembic import command

    from tests.conftest import upgrade_to
    from tests.migration_chains import ce_config

    engine = alembic_engine_at_0020
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO ai_chat_thread (id, owner_subject) VALUES (:id, '7')"), {"id": uuid.uuid4()})
    upgrade_to(engine, "head")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT subject FROM ai_chat_thread")).scalar_one() is None
        column = conn.execute(
            text(
                "SELECT data_type, is_nullable FROM information_schema.columns "
                "WHERE table_name = 'ai_chat_thread' AND column_name = 'subject'"
            )
        ).one()
        assert tuple(column) == ("jsonb", "YES")
    command.downgrade(ce_config(), "0020")
    with engine.connect() as conn:
        names = {
            row[0]
            for row in conn.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_chat_thread'")
            )
        }
    assert "subject" not in names and "origin" in names
