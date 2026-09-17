import json
import time
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
import redis
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from tests.chat_stubs import TOKEN_SECRET, ScriptedChatModel, sign, text_turn, tool_turn
from tests.conftest import REDASH_TEST_URL
from tests.converse_stubs import SPEEDS
from veodyn_api.errors import ErrorId
from veodyn_api.main import create_app
from veodyn_api.models.ai_chat import AiChatTurn
from veodyn_api.routers import ai_chat
from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.services.chat import store
from veodyn_api.services.chat.bus import TurnBus, get_redis
from veodyn_api.services.chat.runner import TurnRunner

RELAY_KEY = "relay-secret"
SQL = "SELECT avg(speed_mph) FROM regional_speeds"
RUN = {"datasetTable": "regional_speeds", "sql": SQL, "purpose": "average", "vizChoiceId": "counter"}


def headers(subject: str = "7") -> dict[str, str]:
    return {"authorization": f"Bearer {RELAY_KEY}", "x-veodyn-user-token": sign(subject, iat=time.time())}


class Harness:
    def __init__(self, client: TestClient, model: ScriptedChatModel, redis_url: str) -> None:
        self.client = client
        self.model = model
        self.redis = redis.Redis.from_url(redis_url)

    def frames(self, turn_id: str) -> list[tuple[str, dict[str, Any]]]:
        entries = self.redis.xrange(f"chat:turn:{turn_id}:frames")
        return [(fields[b"event"].decode(), json.loads(fields[b"data"])) for _, fields in entries]

    def wait_for(self, turn_id: str, event: str, timeout: float = 5.0) -> dict[str, Any]:
        deadline = time.time() + timeout
        while time.time() < deadline:
            for name, data in self.frames(turn_id):
                if name == event:
                    return data
            time.sleep(0.02)
        raise AssertionError(f"no {event} frame for {turn_id}: {self.frames(turn_id)}")

    def thread(self, subject: str = "7") -> str:
        response = self.client.post("/ai/chat/threads", headers=headers(subject))
        assert response.status_code == 201, response.text
        return str(response.json()["id"])

    def turn(self, thread_id: str, text: str = "how fast?", subject: str = "7") -> str:
        response = self.client.post(
            f"/ai/chat/threads/{thread_id}/turns", json={"text": text}, headers=headers(subject)
        )
        assert response.status_code == 202, response.text
        return str(response.json()["turnId"])


@pytest.fixture
def model() -> ScriptedChatModel:
    return ScriptedChatModel()


@pytest.fixture
def harness(
    db: Session, engine: Engine, redis_url: str, model: ScriptedChatModel, monkeypatch: pytest.MonkeyPatch
) -> Iterator[Harness]:
    monkeypatch.setenv("VEODYN_REDASH_URL", REDASH_TEST_URL)
    monkeypatch.setenv("VEODYN_REDASH_SERVICE_API_KEY", "service-key")
    monkeypatch.setenv("VEODYN_AI_RELAY_KEY", RELAY_KEY)
    monkeypatch.setenv("VEODYN_AI_API_KEY", "model-key")
    monkeypatch.setenv("VEODYN_AI_TOKEN_SECRET", TOKEN_SECRET)
    monkeypatch.setattr(ai_chat, "STREAM_BLOCK_MS", 200)

    from veodyn_api.db import get_db
    from veodyn_api.settings import get_settings

    get_settings.cache_clear()
    app = create_app()
    sessions = sessionmaker(bind=engine, expire_on_commit=False)

    def override_db() -> Iterator[Session]:
        yield db

    def override_runner(bus: ai_chat.BusDep) -> TurnRunner:
        async def datasets() -> tuple[DatasetOut, ...]:
            return (SPEEDS,)

        async def data_source_id() -> int:
            return 5

        return TurnRunner(model=model, bus=bus, sessions=sessions, datasets=datasets, data_source_id=data_source_id)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[ai_chat.get_turn_runner] = override_runner
    app.dependency_overrides[ai_chat.get_sessions] = lambda: sessions
    with TestClient(app, raise_server_exceptions=False) as client:
        harness = Harness(client, model, redis_url)
        yield harness
        assert client.portal is not None
        client.portal.call(get_redis().aclose)
        harness.redis.close()


def read_stream(client: TestClient, turn_id: str, last_event_id: str | None = None) -> list[tuple[str, Any]]:
    extra = {"last-event-id": last_event_id} if last_event_id else {}
    response = client.get(f"/ai/chat/turns/{turn_id}/stream", headers={**headers(), **extra})
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["x-accel-buffering"] == "no"
    events: list[tuple[str, Any]] = []
    for chunk in response.text.split("\n\n"):
        fields = dict(line.split(": ", 1) for line in chunk.splitlines() if not line.startswith(":") and ": " in line)
        if "event" in fields:
            events.append((fields["event"], {"id": fields.get("id"), "data": json.loads(fields["data"])}))
    return events


def test_every_route_needs_the_relay_key_and_a_user_token(harness: Harness) -> None:
    client = harness.client
    assert client.get("/ai/chat/threads", headers={"x-veodyn-user-token": sign()}).status_code == 401
    missing_token = client.get("/ai/chat/threads", headers={"authorization": f"Bearer {RELAY_KEY}"})
    assert missing_token.status_code == 401
    assert missing_token.json()["error"]["id"] == ErrorId.UNAUTHENTICATED.value
    assert client.get("/ai/chat/threads", headers=headers()).status_code == 200


def test_threads_are_created_listed_renamed_pinned_and_deleted(harness: Harness) -> None:
    client = harness.client
    first = harness.thread()
    second = harness.thread()
    assert client.patch(f"/ai/chat/threads/{first}", json={"pinned": True}, headers=headers()).json()["pinned"]
    renamed = client.patch(f"/ai/chat/threads/{second}", json={"title": "Speeds"}, headers=headers())
    assert renamed.json()["title"] == "Speeds"
    listing = client.get("/ai/chat/threads", headers=headers()).json()
    assert [one["id"] for one in listing["threads"]] == [first, second]
    assert listing["nextOffset"] is None
    assert client.delete(f"/ai/chat/threads/{first}", headers=headers()).status_code == 204
    assert [one["id"] for one in client.get("/ai/chat/threads", headers=headers()).json()["threads"]] == [second]


def test_another_users_ids_are_not_found(harness: Harness) -> None:
    harness.model.turns.append(text_turn("hi"))
    thread = harness.thread("7")
    turn = harness.turn(thread)
    harness.wait_for(turn, "turn_done")
    client = harness.client
    stranger = headers("8")
    for response in (
        client.get(f"/ai/chat/threads/{thread}", headers=stranger),
        client.patch(f"/ai/chat/threads/{thread}", json={"pinned": True}, headers=stranger),
        client.delete(f"/ai/chat/threads/{thread}", headers=stranger),
        client.post(f"/ai/chat/threads/{thread}/turns", json={"text": "x"}, headers=stranger),
        client.get(f"/ai/chat/turns/{turn}/stream", headers=stranger),
        client.post(f"/ai/chat/turns/{turn}/cancel", headers=stranger),
        client.post(
            f"/ai/chat/turns/{turn}/tool-results",
            json={"callId": "c", "result": {"ok": True, "kind": "query_result"}},
            headers=stranger,
        ),
        client.post(
            f"/ai/chat/drafts/{uuid.uuid4()}/promotions",
            json={"version": 1, "targetType": "query", "targetId": "1"},
            headers=stranger,
        ),
    ):
        assert response.status_code == 404, response.text
        assert response.json()["error"]["id"] == ErrorId.AI_CHAT_NOT_FOUND.value
    assert client.get("/ai/chat/threads", headers=stranger).json()["threads"] == []


def test_a_turn_streams_and_replays_from_the_last_event(harness: Harness) -> None:
    harness.model.turns.append(text_turn("About 31 mph."))
    thread = harness.thread()
    turn = harness.turn(thread, "how fast are buses?")
    events = read_stream(harness.client, turn)
    assert [name for name, _ in events][0] == "turn_started"
    assert events[-1][0] == "turn_done"
    assert ("text_delta", "About 31 mph.") in [(name, body["data"].get("text")) for name, body in events]
    middle = events[1][1]["id"]
    replayed = read_stream(harness.client, turn, last_event_id=middle)
    assert [name for name, _ in replayed] == [name for name, _ in events[2:]]
    detail = harness.client.get(f"/ai/chat/threads/{thread}", headers=headers()).json()
    assert detail["thread"]["title"] == "how fast are buses?"
    [stored] = detail["turns"]
    assert stored["status"] == "done"
    assert stored["blocks"] == [{"role": "assistant", "content": [{"type": "text", "text": "About 31 mph."}]}]


def test_a_query_round_trip_through_the_routes(harness: Harness) -> None:
    harness.model.turns.extend([tool_turn("call-1", "run_query", RUN), text_turn("31.5 mph.")])
    thread = harness.thread()
    turn = harness.turn(thread)
    request = harness.wait_for(turn, "tool_request")
    assert request["args"]["sql"] == SQL
    client = harness.client
    wrong = client.post(
        f"/ai/chat/turns/{turn}/tool-results",
        json={"callId": "other", "result": {"ok": True, "kind": "query_result"}},
        headers=headers(),
    )
    assert wrong.status_code == 409
    assert wrong.json()["error"]["id"] == ErrorId.AI_TOOL_RESULT_REJECTED.value
    mismatched = client.post(
        f"/ai/chat/turns/{turn}/tool-results",
        json={"callId": "call-1", "result": {"ok": True, "kind": "library", "items": []}},
        headers=headers(),
    )
    assert mismatched.status_code == 409
    result = {
        "ok": True,
        "kind": "query_result",
        "rowCount": 1,
        "truncated": False,
        "columns": [{"name": "avg", "type": "float", "nulls": 0, "distinct": 1, "min": 31.5, "max": 31.5}],
        "sample": [{"avg": 31.5}],
    }
    accepted = client.post(
        f"/ai/chat/turns/{turn}/tool-results", json={"callId": "call-1", "result": result}, headers=headers()
    )
    assert accepted.status_code == 202, accepted.text
    harness.wait_for(turn, "turn_done")
    sent = json.loads(harness.model.calls[1]["messages"][2]["content"][0]["content"])
    assert sent["rowCount"] == 1 and sent["sample"] == [{"avg": 31.5}]
    blocks = client.get(f"/ai/chat/threads/{thread}", headers=headers()).json()["turns"][0]["blocks"]
    assert all(block["type"] != "thinking" for message in blocks for block in message["content"])
    late = client.post(
        f"/ai/chat/turns/{turn}/tool-results", json={"callId": "call-1", "result": result}, headers=headers()
    )
    assert late.status_code == 409


def test_an_oversized_sample_is_refused(harness: Harness) -> None:
    harness.model.turns.append(tool_turn("call-1", "run_query", RUN))
    turn = harness.turn(harness.thread())
    harness.wait_for(turn, "tool_request")
    result = {"ok": True, "kind": "query_result", "sample": [{"n": n} for n in range(51)]}
    response = harness.client.post(
        f"/ai/chat/turns/{turn}/tool-results", json={"callId": "call-1", "result": result}, headers=headers()
    )
    assert response.status_code == 422
    harness.client.post(f"/ai/chat/turns/{turn}/cancel", headers=headers())
    harness.wait_for(turn, "turn_done")


def test_a_second_turn_is_refused_while_the_first_runs(harness: Harness) -> None:
    harness.model.turns.extend([tool_turn("call-1", "run_query", RUN), text_turn("done")])
    thread = harness.thread()
    turn = harness.turn(thread)
    harness.wait_for(turn, "tool_request")
    refused = harness.client.post(f"/ai/chat/threads/{thread}/turns", json={"text": "again"}, headers=headers())
    assert refused.status_code == 409
    assert refused.json()["error"]["id"] == ErrorId.AI_TURN_CONFLICT.value
    assert harness.client.post(f"/ai/chat/turns/{turn}/cancel", headers=headers()).status_code == 202
    assert harness.wait_for(turn, "turn_done")["stopReason"] == "cancelled"


def test_a_lost_turn_is_failed_and_the_thread_accepts_a_new_one(harness: Harness, db: Session) -> None:
    thread_id = harness.thread()
    thread = store.thread_for_owner(db, "7", uuid.UUID(thread_id))
    orphan = store.start_turn(db, thread, "orphaned")
    events = read_stream(harness.client, str(orphan.id))
    assert events[-1][0] == "error"
    assert events[-1][1]["data"]["id"] == ErrorId.AI_TURN_LOST.value
    db.expire_all()
    lost = db.get(AiChatTurn, orphan.id)
    assert lost is not None and lost.status == "failed"
    second = store.start_turn(db, thread, "orphaned again")
    harness.model.turns.append(text_turn("back"))
    turn = harness.turn(thread_id, "hello")
    harness.wait_for(turn, "turn_done")
    db.expire_all()
    replaced = db.get(AiChatTurn, second.id)
    assert replaced is not None and replaced.error_id == ErrorId.AI_TURN_LOST.value


def test_a_finished_turn_whose_log_expired_still_ends_its_stream(harness: Harness) -> None:
    harness.model.turns.append(text_turn("done"))
    turn = harness.turn(harness.thread())
    harness.wait_for(turn, "turn_done")
    harness.redis.delete(f"chat:turn:{turn}:frames")
    assert read_stream(harness.client, turn) == [
        ("turn_done", {"id": None, "data": {"stopReason": "end_turn", "usage": text_turn("x").usage}})
    ]


def test_a_draft_is_promoted_and_shown_in_the_thread(harness: Harness) -> None:
    proposal = {"name": "Average speed", "datasetTable": "regional_speeds", "sql": SQL, "vizChoiceId": "counter"}
    harness.model.turns.extend([tool_turn("call-1", "propose_query", proposal), text_turn("Saved as a draft.")])
    thread = harness.thread()
    turn = harness.turn(thread)
    draft = harness.wait_for(turn, "draft")
    harness.wait_for(turn, "turn_done")
    client = harness.client
    promoted = client.post(
        f"/ai/chat/drafts/{draft['draftId']}/promotions",
        json={"version": 1, "targetType": "query", "targetId": "44", "targetVersionAtPromote": 2},
        headers=headers(),
    )
    assert promoted.status_code == 201, promoted.text
    bad = client.post(
        f"/ai/chat/drafts/{draft['draftId']}/promotions",
        json={"version": 1, "targetType": "dashboard", "targetId": "44"},
        headers=headers(),
    )
    assert bad.status_code == 422
    [entry] = client.get(f"/ai/chat/threads/{thread}", headers=headers()).json()["drafts"]
    assert entry["id"] == draft["draftId"]
    assert entry["versions"][0]["payload"]["sql"] == SQL
    assert entry["promotions"][0]["targetId"] == "44"
    assert entry["promotions"][0]["targetVersionAtPromote"] == 2


def test_a_message_over_the_limit_is_refused(harness: Harness) -> None:
    thread = harness.thread()
    response = harness.client.post(f"/ai/chat/threads/{thread}/turns", json={"text": "x" * 4001}, headers=headers())
    assert response.status_code == 422


def test_redis_down_is_unavailable(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    thread = harness.thread()

    async def broken(self: TurnBus, turn_id: str) -> None:
        raise redis.exceptions.ConnectionError("down")

    monkeypatch.setattr(TurnBus, "hold_lease", broken)
    response = harness.client.post(f"/ai/chat/threads/{thread}/turns", json={"text": "hi"}, headers=headers())
    assert response.status_code == 503
    assert response.json()["error"]["id"] == ErrorId.AI_CHAT_UNAVAILABLE.value
    detail = harness.client.get(f"/ai/chat/threads/{thread}", headers=headers()).json()
    assert detail["turns"][0]["status"] == "failed"


def test_a_library_search_round_trip_through_the_routes(harness: Harness) -> None:
    harness.model.turns.extend(
        [tool_turn("call-1", "search_library", {"text": "bikeshare"}), text_turn("Two queries match.")]
    )
    turn = harness.turn(harness.thread())
    request = harness.wait_for(turn, "tool_request")
    assert request == {
        "callId": "call-1",
        "tool": "search_library",
        "args": {"text": "bikeshare", "kinds": ["query", "dashboard"], "tags": []},
    }
    query_result = {"ok": True, "kind": "query_result", "rowCount": 1}
    refused = harness.client.post(
        f"/ai/chat/turns/{turn}/tool-results", json={"callId": "call-1", "result": query_result}, headers=headers()
    )
    assert refused.status_code == 409
    result = {
        "ok": True,
        "kind": "library",
        "items": [
            {"type": "query", "id": 12, "name": "Trips by hour", "tags": ["bikeshare"], "hasResult": True},
            {"type": "dashboard", "id": 4, "name": "Bikeshare overview", "tags": []},
        ],
        "more": False,
    }
    accepted = harness.client.post(
        f"/ai/chat/turns/{turn}/tool-results", json={"callId": "call-1", "result": result}, headers=headers()
    )
    assert accepted.status_code == 202, accepted.text
    settled = harness.wait_for(turn, "tool_settled")
    assert settled["count"] == 2
    harness.wait_for(turn, "turn_done")
    sent = json.loads(harness.model.calls[1]["messages"][2]["content"][0]["content"])
    assert sent["items"][0] == {
        "type": "query",
        "id": 12,
        "name": "Trips by hour",
        "tags": ["bikeshare"],
        "hasResult": True,
    }


@pytest.mark.parametrize(
    "result",
    [
        {"ok": True},
        {"ok": True, "kind": "report"},
        {"ok": True, "kind": "library", "items": [{"type": "alert", "id": 1, "name": "x"}]},
        {"ok": True, "kind": "library", "items": [{"type": "query", "id": 0, "name": "x"}]},
        {"ok": True, "kind": "dashboard", "widgets": [{"title": "t"}]},
        {"ok": True, "kind": "saved_visualization", "query": {"id": 1, "name": "q", "sql": "x" * 8001}},
    ],
)
def test_malformed_results_are_refused(harness: Harness, result: dict[str, Any]) -> None:
    harness.model.turns.append(tool_turn("call-1", "search_library", {"text": "x"}))
    turn = harness.turn(harness.thread())
    harness.wait_for(turn, "tool_request")
    response = harness.client.post(
        f"/ai/chat/turns/{turn}/tool-results", json={"callId": "call-1", "result": result}, headers=headers()
    )
    assert response.status_code == 422, response.text
    harness.client.post(f"/ai/chat/turns/{turn}/cancel", headers=headers())
    harness.wait_for(turn, "turn_done")
