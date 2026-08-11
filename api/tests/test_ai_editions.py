"""Which `/ai` paths a community build serves, and what it may import.

This file was written one task before the move, when both halves still lived in
this tree and the difference between a community build and a composed one had to
be simulated by clearing the registries. It does not have to be simulated any
more: `create_app()` here IS the community build, and the enterprise half is in
another repository.

What is left is the community side of two claims. The paths, which now come off
an app with nothing cleared, and the import direction, which is the property
that would break community startup if it ever inverted. The composed half of
both (the four enterprise paths arriving through the router seam, and the
enterprise router being allowed to reach the community one) is in the pack's own
copy of this file, where there is something to assert it against.

A note for whoever reads the brief beside this file: FastAPI 0.139 records an
`include_router` call as one `_IncludedRouter` placeholder with no `path`, so
walking `app.routes` finds `/health` and nothing else. Paths come off the
generated schema, the same way `tests/test_registry_providers.py` reads them.
"""

from pathlib import Path

import httpx
import pytest
import respx
from fastapi import FastAPI

import veodyn_api
from tests.ce_imports import module_file, reachable_from
from tests.conftest import REDASH_TEST_URL
from tests.converse_stubs import AUTH, FakeChatLlm, answer, build, mock_data_sources
from veodyn_api.main import create_app

COMMUNITY_AI_PATHS = ["/ai/converse", "/ai/generate-sql"]
ENTERPRISE_AI_PATHS = ["/ai/digest", "/ai/outline", "/ai/report", "/ai/suggest-annotations"]

PACKAGE = Path(veodyn_api.__file__).parent


def ai_paths(app: FastAPI) -> list[str]:
    return sorted(path for path in app.openapi()["paths"] if path.startswith("/ai/"))


def test_a_community_build_serves_exactly_the_two_community_ai_paths() -> None:
    """The assertion the split was for, now measurable without a fixture.

    Not "two paths are served": that the four enterprise ones are ABSENT is the
    half that can regress, and it regresses by somebody moving an endpoint back
    into `routers/ai.py` rather than by anybody deleting a test.
    """
    served = ai_paths(create_app())

    assert served == COMMUNITY_AI_PATHS
    assert set(served) & set(ENTERPRISE_AI_PATHS) == set()


def test_no_enterprise_ai_module_is_left_in_the_tree() -> None:
    """The files themselves, not their imports. A module nobody imports is
    invisible to the closure walk below, and an enterprise service left behind
    unimported is still enterprise code in a public tree."""
    for module in (
        "veodyn_api.builtin_ee",
        "veodyn_api.routers.ai_ee",
        "veodyn_api.schemas.ai_ee",
        "veodyn_api.services.ai_annotations",
        "veodyn_api.services.ai_digest",
        "veodyn_api.services.ai_outline_ee",
        "veodyn_api.services.ai_report",
    ):
        assert module_file(module) is None, f"{module} is still in the community package"


def test_the_community_ai_router_still_reaches_the_service_it_needs() -> None:
    """The positive control for the closure walk that
    `test_ce_has_no_ee_code.py` runs over the whole package.

    `services/ai_outline` is deliberately still reachable and `ai_outline_ee` is
    gone: the outline service was treated as one enterprise unit and it is two.
    `ai_converse_schema.py` and `ai_converse_outline.py` both import from it and
    both are on the community converse path, so `NO_QUERY` and `outline_schema`
    stayed while `build_outline` went.
    """
    reachable = reachable_from("veodyn_api.routers.ai")

    assert "veodyn_api.services.ai_sql" in reachable
    assert "veodyn_api.services.ai_outline" in reachable


@respx.mock
def test_a_community_build_can_still_propose_a_report(monkeypatch: pytest.MonkeyPatch) -> None:
    """`ReportOutlineOut` and `NewQueryProposalOut` stay in the community schema
    because `schemas/ai_create.py` imports them, so a converse turn can propose a
    report on a build that cannot generate one. A split that took them to the
    pack would turn that turn into a 502 against the relay's strict schema.
    """
    mock_data_sources((1, "Warehouse"))
    respx.get(f"{REDASH_TEST_URL}/api/queries").mock(
        return_value=httpx.Response(
            200, json={"results": [{"id": 11, "name": "Speeds by corridor", "updated_at": "2026-07-20"}]}
        )
    )
    llm = FakeChatLlm(
        answer(
            outline={
                "goal": "Weekly review",
                "sections": [{"title": "Speeds", "intent": "speed over time", "queryId": 11, "suggested": False}],
            }
        )
    )

    api = build(llm, monkeypatch)
    response = api.post(
        "/ai/converse",
        json={"kind": "report", "messages": [{"role": "user", "content": "a weekly review please"}]},
        headers=AUTH,
    )

    assert response.status_code == 200
    proposal = response.json()["proposal"]
    assert proposal["kind"] == "report"
    assert [section["sourceQueryId"] for section in proposal["outline"]["sections"]] == [11]
