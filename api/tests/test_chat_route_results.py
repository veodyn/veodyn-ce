import json
from typing import Any, cast

import pytest

from tests.chat_route_harness import SQL, Harness, headers
from tests.chat_stubs import text_turn, tool_turn
from tests.test_chat_routes import harness, model  # noqa: F401


@pytest.fixture
def routes(request: pytest.FixtureRequest) -> Harness:
    return cast(Harness, request.getfixturevalue("harness"))


def test_a_draft_is_promoted_and_shown_in_the_thread(routes: Harness) -> None:
    proposal = {"name": "Average speed", "datasetTable": "regional_speeds", "sql": SQL, "vizChoiceId": "counter"}
    routes.model.turns.extend([tool_turn("call-1", "propose_query", proposal), text_turn("Saved as a draft.")])
    thread = routes.thread()
    turn = routes.turn(thread)
    draft = routes.wait_for(turn, "draft")
    routes.wait_for(turn, "turn_done")
    client = routes.client
    promoted = client.post(
        f"/ai/chat/drafts/{draft['draftId']}/promotions",
        json={"version": 1, "targetType": "query", "targetId": "44", "targetVersionAtPromote": 2},
        headers=headers(),
    )
    assert promoted.status_code == 201, promoted.text
    dashboard_promotion = client.post(
        f"/ai/chat/drafts/{draft['draftId']}/promotions",
        json={"version": 1, "targetType": "dashboard", "targetId": "9"},
        headers=headers(),
    )
    assert dashboard_promotion.status_code == 201, dashboard_promotion.text
    bad = client.post(
        f"/ai/chat/drafts/{draft['draftId']}/promotions",
        json={"version": 1, "targetType": "kpi", "targetId": "44"},
        headers=headers(),
    )
    assert bad.status_code == 422
    [entry] = client.get(f"/ai/chat/threads/{thread}", headers=headers()).json()["drafts"]
    assert entry["id"] == draft["draftId"]
    assert entry["versions"][0]["payload"]["sql"] == SQL
    assert [(one["targetType"], one["targetId"]) for one in entry["promotions"]] == [
        ("query", "44"),
        ("dashboard", "9"),
    ]
    assert entry["promotions"][0]["targetVersionAtPromote"] == 2


def test_a_library_search_round_trip_through_the_routes(routes: Harness) -> None:
    routes.model.turns.extend(
        [tool_turn("call-1", "search_library", {"text": "bikeshare"}), text_turn("Two queries match.")]
    )
    turn = routes.turn(routes.thread())
    request = routes.wait_for(turn, "tool_request")
    assert request == {
        "callId": "call-1",
        "tool": "search_library",
        "args": {"text": "bikeshare", "kinds": ["query", "dashboard"], "tags": [], "sort": "match", "archived": False},
        "resultKind": "library",
    }
    query_result = {"ok": True, "kind": "query_result", "rowCount": 1}
    refused = routes.client.post(
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
    accepted = routes.client.post(
        f"/ai/chat/turns/{turn}/tool-results", json={"callId": "call-1", "result": result}, headers=headers()
    )
    assert accepted.status_code == 202, accepted.text
    settled = routes.wait_for(turn, "tool_settled")
    assert settled["count"] == 2
    routes.wait_for(turn, "turn_done")
    sent = json.loads(routes.model.calls[1]["messages"][2]["content"][0]["content"])
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
        {"ok": True, "kind": "Report"},
        {"ok": True, "kind": "library", "items": [{"type": "alert", "id": 1, "name": "x"}]},
        {"ok": True, "kind": "library", "items": [{"type": "query", "id": 0, "name": "x"}]},
        {"ok": True, "kind": "dashboard", "widgets": [{"title": "t"}]},
        {"ok": True, "kind": "saved_visualization", "query": {"id": 1, "name": "q", "sql": "x" * 8001}},
    ],
)
def test_malformed_results_are_refused(routes: Harness, result: dict[str, Any]) -> None:
    routes.model.turns.append(tool_turn("call-1", "search_library", {"text": "x"}))
    turn = routes.turn(routes.thread())
    routes.wait_for(turn, "tool_request")
    response = routes.client.post(
        f"/ai/chat/turns/{turn}/tool-results", json={"callId": "call-1", "result": result}, headers=headers()
    )
    assert response.status_code == 422, response.text
    routes.client.post(f"/ai/chat/turns/{turn}/cancel", headers=headers())
    routes.wait_for(turn, "turn_done")


def test_a_message_over_the_limit_is_refused(routes: Harness) -> None:
    thread = routes.thread()
    response = routes.client.post(f"/ai/chat/threads/{thread}/turns", json={"text": "x" * 4001}, headers=headers())
    assert response.status_code == 422
