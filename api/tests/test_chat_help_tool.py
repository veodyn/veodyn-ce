import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from tests.converse_stubs import SPEEDS
from veodyn_api.services.chat import help_index
from veodyn_api.services.chat.help_index import build_index, load_index, render
from veodyn_api.services.chat.prompt import CHAT_RULES, chat_system
from veodyn_api.services.chat.tools import Immediate, ToolContext, prepare_call

pytestmark = pytest.mark.anyio

PAGES = {
    "intro.md": "---\nslug: /\ntitle: Documentation\ndescription: What Veodyn is.\n---\n\n## What a node is\n",
    "features/queries.md": (
        "---\ntitle: Queries\ndescription: Write and schedule SQL.\n---\n\n"
        "## Parameters\n\n### Date ranges\n\n## Wall mode (enterprise) {#wall-mode}\n"
    ),
    "features/schedules.md": "---\ntitle: Schedules\ndescription: Refresh queries on a timer.\n---\n\n## Intervals\n",
    "features/dashboards.md": "---\ntitle: Dashboards\n---\n\n## Sharing\n",
}


@pytest.fixture
def docs_index(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    root = tmp_path / "docs"
    for relative, text in PAGES.items():
        (root / relative).parent.mkdir(parents=True, exist_ok=True)
        (root / relative).write_text(text)
    path = tmp_path / "help_index.json"
    path.write_text(render(build_index(root)))
    monkeypatch.setattr(help_index, "INDEX_PATH", path)
    load_index.cache_clear()
    yield path
    load_index.cache_clear()


@pytest.fixture
def no_index(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(help_index, "INDEX_PATH", tmp_path / "absent.json")
    load_index.cache_clear()
    yield
    load_index.cache_clear()


def context() -> ToolContext:
    async def data_source_id() -> int:
        return 5

    def data_source_info(source_id: int) -> None:
        return None

    async def save_draft(kind: str, draft_id: str | None, payload: dict[str, Any]) -> tuple[str, int]:
        return "d", 1

    async def query_draft_exists(draft_id: str) -> bool:
        return False

    return ToolContext(
        datasets=(SPEEDS,),
        data_source_id=data_source_id,
        data_source_info=data_source_info,
        save_draft=save_draft,
        query_draft_exists=query_draft_exists,
    )


def link(call_id: str = "call-1", **arguments: Any) -> dict[str, Any]:
    return {"type": "tool_use", "id": call_id, "name": "link_help", "input": arguments}


async def linked(ctx: ToolContext, **arguments: Any) -> Immediate:
    outcome = await prepare_call(link(**arguments), ctx)
    assert isinstance(outcome, Immediate)
    return outcome


async def test_a_section_link_answers_the_model_and_shows_the_analyst_a_card(docs_index: Path) -> None:
    outcome = await linked(context(), page="features/queries", section="date-ranges", reason="Date filters")
    assert not outcome.is_error
    assert json.loads(outcome.content) == {
        "linked": True,
        "page": "features/queries",
        "section": "date-ranges",
        "pageTitle": "Queries",
        "sectionTitle": "Date ranges",
    }
    assert outcome.frame == (
        "help_link",
        {
            "callId": "call-1",
            "page": "features/queries",
            "pageTitle": "Queries",
            "anchor": "date-ranges",
            "sectionTitle": "Date ranges",
            "reason": "Date filters",
        },
    )


async def test_a_whole_page_link_has_no_section(docs_index: Path) -> None:
    outcome = await linked(context(), page="features/schedules", reason="Schedules")
    assert not outcome.is_error
    assert outcome.frame is not None
    assert outcome.frame[1]["anchor"] is None and outcome.frame[1]["sectionTitle"] is None
    assert json.loads(outcome.content)["section"] is None


async def test_the_root_page_and_a_leading_hash_are_accepted(docs_index: Path) -> None:
    outcome = await linked(context(), page="/", section="#what-a-node-is", reason="Overview")
    assert not outcome.is_error
    assert outcome.frame is not None
    assert outcome.frame[1]["page"] == "" and outcome.frame[1]["anchor"] == "what-a-node-is"


async def test_a_missing_page_is_an_error_rather_than_a_link_to_the_introduction(docs_index: Path) -> None:
    outcome = await linked(context(), reason="x")
    assert outcome.is_error and outcome.frame is None
    assert "page" in outcome.content


async def test_an_unknown_page_suggests_the_pages_sharing_the_most_words(docs_index: Path) -> None:
    outcome = await linked(context(), page="features/schedule-timers", reason="x")
    assert outcome.is_error and outcome.frame is None
    assert "features/schedules" in outcome.content
    assert "features/dashboards" not in outcome.content


async def test_an_unknown_page_with_no_match_points_back_to_the_index(docs_index: Path) -> None:
    outcome = await linked(context(), page="billing", reason="x")
    assert outcome.is_error
    assert "no page" in outcome.content.lower()


async def test_an_unknown_section_lists_the_page_anchors(docs_index: Path) -> None:
    outcome = await linked(context(), page="features/queries", section="filters", reason="x")
    assert outcome.is_error and outcome.frame is None
    assert "parameters" in outcome.content and "date-ranges" in outcome.content and "wall-mode" in outcome.content


async def test_a_fourth_link_in_one_turn_is_refused(docs_index: Path) -> None:
    ctx = context()
    for _ in range(3):
        assert not (await linked(ctx, page="features/schedules", reason="x")).is_error
    fourth = await linked(ctx, page="features/schedules", reason="x")
    assert fourth.is_error and fourth.frame is None
    assert "stop" in fourth.content.lower()


async def test_a_refused_link_does_not_use_up_the_limit(docs_index: Path) -> None:
    ctx = context()
    for _ in range(3):
        await linked(ctx, page="nowhere", reason="x")
    assert not (await linked(ctx, page="features/schedules", reason="x")).is_error


async def test_without_an_index_the_documentation_is_unavailable(no_index: None) -> None:
    outcome = await linked(context(), page="features/queries", reason="x")
    assert outcome.is_error and outcome.frame is None
    assert "documentation is unavailable" in outcome.content


def test_the_prompt_carries_the_docs_index_between_the_rules_and_the_catalog(docs_index: Path) -> None:
    blocks = chat_system((SPEEDS,), omitted_history=False)
    texts = [block["text"] for block in blocks]
    [docs] = [index for index, text in enumerate(texts) if text.startswith("Veodyn documentation")]
    assert docs == 1
    assert "regional_speeds" in texts[2]
    assert "features/queries | Queries | Write and schedule SQL." in texts[1]
    assert "    #date-ranges Date ranges" in texts[1]


def test_the_prompt_leaves_the_docs_out_when_the_index_is_missing(no_index: None) -> None:
    texts = [block["text"] for block in chat_system((SPEEDS,), omitted_history=False)]
    assert not any(text.startswith("Veodyn documentation") for text in texts)
    assert len(texts) == 2


def test_the_rules_send_how_to_questions_to_the_docs() -> None:
    assert "`link_help`" in CHAT_RULES
    assert "Never write documentation URLs" in CHAT_RULES
    assert "documentation does not cover it" in CHAT_RULES
