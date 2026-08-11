"""/ai/converse as the veodyn-de relay sees it, plus the caps and the cache.

The gate is unlike every other router here: there is no Redash session to
resolve, only a shared bearer, because the relay strips the browser cookie
before calling out. The service-side checks of what the model NAMED live in
test_ai_converse.py.
"""

from collections.abc import Iterator

import pytest
from pydantic import ValidationError

from tests.converse_stubs import AUTH, FakeChatLlm, answer, ask, build
from veodyn_api.schemas.ai_create import ConverseIn, ConverseMessageIn
from veodyn_api.schemas.catalog import DatasetCoverageOut, DatasetFreshnessOut, DatasetOut
from veodyn_api.services.ai_converse_grounding import (
    Grounding,
    clear_grounding_cache,
)


@pytest.fixture(autouse=True)
def _clear_grounding() -> Iterator[None]:
    clear_grounding_cache()
    yield
    clear_grounding_cache()


def dataset_at(table: str, day: str) -> DatasetOut:
    """A catalog entry that differs only in name and freshness."""
    return DatasetOut(
        id=table,
        name=table,
        description="",
        domain=None,
        schema=[],
        freshness=DatasetFreshnessOut(last_updated_at=f"{day}T00:00:00Z", status="fresh"),
        coverage=DatasetCoverageOut(start="", end=""),
        row_count=1,
        sources=[],
        tags=[],
        sample_query_id=None,
    )


# --- caps and transcript shape ----------------------------------------------


def test_the_thirteenth_user_turn_is_refused() -> None:
    """Twelve, from ai-create.ts. A conversation that has not converged in
    twelve turns will not, and truncating loses the goal that opened it."""
    twelve = [ConverseMessageIn(role="user", content="x") for _ in range(12)]

    ConverseIn(kind="query", messages=twelve)
    with pytest.raises(ValidationError):
        ConverseIn(kind="query", messages=[*twelve, ConverseMessageIn(role="user", content="x")])


def test_a_message_past_the_character_cap_is_refused() -> None:
    ConverseIn(kind="query", messages=[ConverseMessageIn(role="user", content="x" * 4_000)])
    with pytest.raises(ValidationError):
        ConverseIn(kind="query", messages=[ConverseMessageIn(role="user", content="x" * 4_001)])


def test_a_transcript_that_opens_with_an_assistant_turn_is_repaired() -> None:
    """The Messages API answers 400 to a list that does not start with a user
    turn, and the composer is the half of this an attacker can rewrite."""
    llm = FakeChatLlm({"reply": "ok", "suggestedAnswers": [], "ready": False})
    payload = ConverseIn(
        kind="snippet",
        messages=[
            ConverseMessageIn(role="assistant", content="Hi there"),
            ConverseMessageIn(role="user", content="a snippet please"),
        ],
    )

    ask(llm, payload, Grounding("snippet"))

    assert llm.transcripts[0] == [{"role": "user", "content": "a snippet please"}]


# --- the route --------------------------------------------------------------

SNIPPET_BODY = {"kind": "snippet", "messages": [{"role": "user", "content": "a snippet for last 7 days"}]}


def test_the_route_refuses_a_request_with_no_relay_bearer(monkeypatch: pytest.MonkeyPatch) -> None:
    """The bearer is the entire gate: the relay strips the browser cookie, so
    there is no caller identity behind it to fall back on."""
    llm = FakeChatLlm()

    response = build(llm, monkeypatch).post("/ai/converse", json=SNIPPET_BODY)

    assert response.status_code == 401
    assert llm.calls == 0


def test_the_route_refuses_the_wrong_bearer(monkeypatch: pytest.MonkeyPatch) -> None:
    llm = FakeChatLlm()
    headers = {"authorization": "Bearer not-the-key"}

    response = build(llm, monkeypatch).post("/ai/converse", json=SNIPPET_BODY, headers=headers)

    assert response.status_code == 401
    assert llm.calls == 0


def test_an_instance_with_no_relay_key_answers_unavailable_rather_than_open(monkeypatch: pytest.MonkeyPatch) -> None:
    llm = FakeChatLlm()

    api = build(llm, monkeypatch, VEODYN_AI_RELAY_KEY="")
    response = api.post("/ai/converse", json=SNIPPET_BODY, headers=AUTH)

    assert response.status_code == 503
    assert response.json()["error"]["id"] == "VEODYN_AI_NOT_CONFIGURED"
    assert llm.calls == 0


def test_the_route_answers_the_five_fields_the_relay_accepts(monkeypatch: pytest.MonkeyPatch) -> None:
    """The relay's Zod schema is exact. An extra key or a missing one is a 502
    to the analyst rather than something it quietly tolerates."""
    llm = FakeChatLlm(answer(trigger="last7", snippet="captured_at > now() - 7", description="A week"))

    response = build(llm, monkeypatch).post("/ai/converse", json=SNIPPET_BODY, headers=AUTH)

    assert response.status_code == 200
    assert response.json() == {
        "reply": "Here it is.",
        "suggestedAnswers": [],
        "ready": True,
        "focusTable": None,
        "proposal": {
            "kind": "snippet",
            "trigger": "last7",
            "snippet": "captured_at > now() - 7",
            "description": "A week",
        },
    }


def test_an_interview_turn_still_carries_the_proposal_and_focus_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    """Present-and-null, not absent: the relay's schema requires both keys, so a
    turn that serialized either away would be a 502 rather than a question."""
    llm = FakeChatLlm({"reply": "Which corridor?", "suggestedAnswers": ["Route 1"], "ready": False})

    response = build(llm, monkeypatch).post("/ai/converse", json=SNIPPET_BODY, headers=AUTH)

    assert response.status_code == 200
    assert response.json() == {
        "reply": "Which corridor?",
        "suggestedAnswers": ["Route 1"],
        "ready": False,
        "proposal": None,
        "focusTable": None,
    }


def test_the_route_refuses_a_transcript_past_the_message_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    """Re-enforced here because the service is the only one of the three copies
    of this cap that an attacker cannot replace."""
    llm = FakeChatLlm()
    body = {"kind": "snippet", "messages": [{"role": "user", "content": "x"} for _ in range(26)]}

    response = build(llm, monkeypatch).post("/ai/converse", json=body, headers=AUTH)

    assert response.status_code == 422
    assert llm.calls == 0


def test_the_route_refuses_an_unknown_kind(monkeypatch: pytest.MonkeyPatch) -> None:
    llm = FakeChatLlm()
    body = {"kind": "alert", "messages": [{"role": "user", "content": "x"}]}

    response = build(llm, monkeypatch).post("/ai/converse", json=body, headers=AUTH)

    assert response.status_code == 422
    assert llm.calls == 0
