import json
import time
from typing import Any

import redis
from fastapi.testclient import TestClient

from tests.chat_stubs import ScriptedChatModel, sign, text_turn

RELAY_KEY = "relay-secret"
SQL = "SELECT avg(speed_mph) FROM regional_speeds"
SOURCES = [{"id": id_, "name": f"Source {id_}", "type": "pg", "syntax": "sql", "viewOnly": False} for id_ in (1, 5)]
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

    def talked(self, subject: str = "7") -> str:
        self.model.turns.append(text_turn("ok"))
        thread = self.thread(subject)
        self.wait_for(self.turn(thread, subject=subject), "turn_done")
        return thread

    def turn(self, thread_id: str, text: str = "how fast?", subject: str = "7") -> str:
        response = self.client.post(
            f"/ai/chat/threads/{thread_id}/turns",
            json={"text": text, "dataSources": SOURCES},
            headers=headers(subject),
        )
        assert response.status_code == 202, response.text
        return str(response.json()["turnId"])


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
