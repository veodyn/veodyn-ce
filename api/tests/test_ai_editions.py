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

from fastapi import FastAPI

import veodyn_api
from tests.ce_imports import module_file, reachable_from
from veodyn_api.main import create_app

COMMUNITY_AI_PATHS = [
    "/ai/chat/drafts/{draft_id}/promotions",
    "/ai/chat/drafts/{draft_id}/promotions/{promotion_id}",
    "/ai/chat/mcp/calls",
    "/ai/chat/mcp/calls/{call_id}/result",
    "/ai/chat/mcp/tools",
    "/ai/chat/threads",
    "/ai/chat/threads/{thread_id}",
    "/ai/chat/threads/{thread_id}/subject",
    "/ai/chat/threads/{thread_id}/turns",
    "/ai/chat/turns/{turn_id}/cancel",
    "/ai/chat/turns/{turn_id}/stream",
    "/ai/chat/turns/{turn_id}/tool-results",
    "/ai/generate-sql",
]
ENTERPRISE_AI_PATHS = ["/ai/digest", "/ai/outline", "/ai/report", "/ai/suggest-annotations"]

PACKAGE = Path(veodyn_api.__file__).parent


def ai_paths(app: FastAPI) -> list[str]:
    return sorted(path for path in app.openapi()["paths"] if path.startswith("/ai/"))


def test_a_community_build_serves_exactly_the_community_ai_paths() -> None:
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
    `test_ce_has_no_ee_code.py` runs over the whole package."""
    reachable = reachable_from("veodyn_api.routers.ai")

    assert "veodyn_api.services.ai_sql" in reachable
