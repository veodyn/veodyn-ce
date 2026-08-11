"""Editing an existing dashboard through the Create-with-AI conversation.

The difference from a creation turn is one field on the request, and it is
deliberately only an ID: the widgets the dashboard actually holds are read here
from Redash as the caller, never accepted from the browser, so the endpoint
keeps the property the rest of it has. A modified client cannot make the model
believe the dashboard contains something it does not.
"""

from typing import Any, cast

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from tests.conftest import REDASH_TEST_URL
from tests.converse_stubs import (
    AUTH,
    QUERIES,
    FakeChatLlm,
    answer,
    build,
    mock_data_sources,
    resolves_to,
    turn,
    viz,
)
from veodyn_api.schemas.ai_create import ConverseIn, ConverseMessageIn
from veodyn_api.services.ai_converse import converse
from veodyn_api.services.ai_converse_grounding import Grounding, with_widget_queries
from veodyn_api.services.ai_grounding import DashboardWidget
from veodyn_api.services.llm import LlmClient

REDASH = REDASH_TEST_URL

CURRENT = (
    DashboardWidget(widget_id=501, query_id=11, query_name="Speeds by corridor"),
    DashboardWidget(widget_id=502, query_id=12, query_name="Boardings by stop"),
)


def mock_query_listing() -> None:
    """The grounding the route assembles before it looks at any target."""
    mock_data_sources((1, "Warehouse"))
    respx.get(f"{REDASH}/api/queries").mock(
        return_value=httpx.Response(
            200,
            json={
                "results": [
                    {"id": one.query_id, "name": one.query_name, "updated_at": "2026-07-20"} for one in CURRENT
                ]
            },
        )
    )


def widgets_payload() -> dict[str, Any]:
    return {
        "widgets": [
            {
                "id": one.widget_id,
                "visualization": {"id": 90 + i, "query": {"id": one.query_id, "name": one.query_name}},
            }
            for i, one in enumerate(CURRENT)
        ]
    }


def edit_turn(dashboard_id: int, text: str = "drop the boardings one") -> ConverseIn:
    return ConverseIn(
        kind="dashboard",
        messages=[ConverseMessageIn(role="user", content=text)],
        target_dashboard_id=dashboard_id,
    )


def test_the_model_is_told_what_the_dashboard_already_holds() -> None:
    llm = FakeChatLlm(answer(ready=False))

    converse(
        cast(LlmClient, llm),
        edit_turn(7),
        Grounding("dashboard", queries=QUERIES),
        resolve_visualization=resolves_to(99),
        editing=CURRENT,
    )

    system = llm.systems[-1]
    assert "EDITING" in system
    assert "Speeds by corridor" in system
    assert "Boardings by stop" in system


def test_a_creation_turn_is_told_nothing_about_any_dashboard() -> None:
    # The same prompt builder serves both, so the absence is worth pinning:
    # a creation conversation that opened by describing somebody else's
    # dashboard would be a leak, not a quirk.
    llm = FakeChatLlm(answer(ready=False))

    converse(
        cast(LlmClient, llm),
        turn("dashboard"),
        Grounding("dashboard", queries=QUERIES),
        resolve_visualization=resolves_to(99),
    )

    assert "EDITING" not in llm.systems[-1]


def test_the_model_is_told_to_return_the_whole_list_not_a_set_of_removals() -> None:
    # The browser computes the difference against real widget ids. Asking the
    # model to name what to delete would put a destructive operation in the
    # hands of the half that cannot be trusted with ids, which is the whole
    # division of labour this endpoint is built on.
    llm = FakeChatLlm(answer(ready=False))

    converse(
        cast(LlmClient, llm),
        edit_turn(7),
        Grounding("dashboard", queries=QUERIES),
        resolve_visualization=resolves_to(99),
        editing=CURRENT,
    )

    system = llm.systems[-1]
    assert "including the widgets it already has" in system
    assert "do not drop a widget unless the user asked" in system


@respx.mock
def test_the_route_reads_the_dashboard_itself(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_query_listing()
    dashboard = respx.get(f"{REDASH}/api/dashboards/7").mock(return_value=httpx.Response(200, json=widgets_payload()))
    llm = FakeChatLlm(answer(ready=False))
    client: TestClient = build(llm, monkeypatch)

    response = client.post(
        "/ai/converse",
        json={"kind": "dashboard", "messages": [{"role": "user", "content": "change it"}], "targetDashboardId": 7},
        headers=AUTH,
    )

    assert response.status_code == 200
    assert dashboard.called
    # On "EDITING", not on a query name: the query listing that grounds every
    # dashboard conversation names the same queries, so asserting one of those
    # passes whether or not the target was ever handed to the model.
    assert "EDITING" in llm.systems[-1]
    assert "Boardings by stop" in llm.systems[-1]


@respx.mock
def test_a_dashboard_that_cannot_be_read_still_answers(monkeypatch: pytest.MonkeyPatch) -> None:
    # A conversation is not the place to fail over a target that has been
    # deleted or is not readable. The turn degrades to an ordinary creation
    # one, and the browser still diffs the proposal against what is really on
    # the dashboard, so nothing is applied on a false picture.
    mock_query_listing()
    respx.get(f"{REDASH}/api/dashboards/7").mock(return_value=httpx.Response(404))
    llm = FakeChatLlm(answer(ready=False))
    client: TestClient = build(llm, monkeypatch)

    response = client.post(
        "/ai/converse",
        json={"kind": "dashboard", "messages": [{"role": "user", "content": "change it"}], "targetDashboardId": 7},
        headers=AUTH,
    )

    assert response.status_code == 200
    assert "EDITING" not in llm.systems[-1]


# A widget whose query the listing does not carry. Published-only and capped at
# `ai_max_grounded_queries`, that listing misses a draft and misses anything
# older than the newest sixty, and neither makes the widget less real.
UNLISTED = DashboardWidget(widget_id=503, query_id=50, query_name="Rail as GeoJSON")


def test_a_widget_query_outside_the_listing_is_still_one_the_model_may_name() -> None:
    grounding = Grounding("dashboard", queries=QUERIES)

    widened = with_widget_queries(grounding, (*CURRENT, UNLISTED))

    assert [one.id for one in widened.queries] == [50, 11, 12]


def test_widening_leaves_the_shared_grounding_alone() -> None:
    # build_grounding hands the same instance to every conversation of this kind
    # until its TTL runs out. Appending to it would ground the next unrelated
    # chat on one dashboard's queries.
    grounding = Grounding("dashboard", queries=QUERIES)

    with_widget_queries(grounding, (*CURRENT, UNLISTED))

    assert [one.id for one in grounding.queries] == [11, 12]


def test_a_query_already_in_the_listing_is_not_repeated() -> None:
    widened = with_widget_queries(Grounding("dashboard", queries=QUERIES), CURRENT)

    assert [one.id for one in widened.queries] == [11, 12]


def test_two_widgets_over_one_query_add_it_once() -> None:
    twice = (UNLISTED, DashboardWidget(widget_id=504, query_id=50, query_name="Rail as GeoJSON"))

    widened = with_widget_queries(Grounding("dashboard", queries=QUERIES), twice)

    assert [one.id for one in widened.queries] == [50, 11, 12]


def test_a_dashboard_whose_query_is_off_the_listing_still_gets_a_proposal() -> None:
    # The turn this fixes came back "I could not resolve query 50, so I have not
    # proposed anything yet", with the widgets that DID resolve discarded
    # alongside it, for a dashboard whose own widget the model was told to keep.
    editing = (*CURRENT, UNLISTED)
    llm = FakeChatLlm(
        answer(
            name="Rail ops",
            widgets=[
                {"title": "Speeds by corridor", "queryId": 11},
                {"title": "Rail as GeoJSON", "queryId": 50},
            ],
        )
    )

    result = converse(
        cast(LlmClient, llm),
        edit_turn(7),
        with_widget_queries(Grounding("dashboard", queries=QUERIES), editing),
        resolve_visualization=lambda query_id: (viz(900 + query_id),),
        editing=editing,
    )

    assert result.ready
    assert result.proposal is not None
    assert [one.query_id for one in result.proposal.widgets] == [11, 50]


@respx.mock
def test_the_route_widens_the_grounding_with_the_targets_own_queries(monkeypatch: pytest.MonkeyPatch) -> None:
    # The route is what has to do the widening. Asserted here rather than only
    # against with_widget_queries, because a test that calls the helper itself
    # passes just as well with the call in routers/ai.py deleted.
    mock_query_listing()  # 11 and 12 only: query 50 is not in the listing.
    respx.get(f"{REDASH}/api/dashboards/7").mock(
        return_value=httpx.Response(
            200,
            json={
                "widgets": [
                    *widgets_payload()["widgets"],
                    {
                        "id": UNLISTED.widget_id,
                        "visualization": {
                            "id": 95,
                            "type": "CHART",
                            "query": {"id": UNLISTED.query_id, "name": UNLISTED.query_name},
                        },
                    },
                ]
            },
        )
    )
    respx.get(f"{REDASH}/api/queries/50").mock(
        return_value=httpx.Response(200, json={"visualizations": [{"id": 95, "type": "CHART"}]})
    )
    llm = FakeChatLlm(answer(name="Rail ops", widgets=[{"title": "Rail as GeoJSON", "queryId": 50}]))
    client: TestClient = build(llm, monkeypatch)

    response = client.post(
        "/ai/converse",
        json={"kind": "dashboard", "messages": [{"role": "user", "content": "change it"}], "targetDashboardId": 7},
        headers=AUTH,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is True, body["reply"]
    assert [one["queryId"] for one in body["proposal"]["widgets"]] == [50]


def test_a_target_is_refused_unless_it_is_a_real_id(monkeypatch: pytest.MonkeyPatch) -> None:
    llm = FakeChatLlm(answer(ready=False))
    client: TestClient = build(llm, monkeypatch)

    response = client.post(
        "/ai/converse",
        json={"kind": "dashboard", "messages": [{"role": "user", "content": "x"}], "targetDashboardId": 0},
        headers=AUTH,
    )

    assert response.status_code == 422
