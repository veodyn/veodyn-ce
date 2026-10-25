import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from tests.catalog_stubs import SPEEDS
from veodyn_api.schemas.ai_chat_context import ChatInstanceIn
from veodyn_api.services.chat import help_index
from veodyn_api.services.chat.help_filter import for_edition
from veodyn_api.services.chat.help_index import HelpIndex, HelpPage, HelpSection, build_index, load_index, render
from veodyn_api.services.chat.prompt import chat_system
from veodyn_api.services.chat.tools import Immediate, ToolContext, prepare_call
from veodyn_api.services.chat.turn_context import TurnContext

pytestmark = pytest.mark.anyio

PAGES = {
    "features/queries.md": (
        "---\ntitle: Queries\ndescription: Write SQL.\nenterprise_sections: [wall-mode]\n---\n\n"
        "## Parameters\n\n## Wall mode {#wall-mode}\n"
    ),
    "features/kpis.md": "---\ntitle: KPIs\ndescription: Targets.\nedition: enterprise\n---\n\n## Targets\n",
}

INDEX = HelpIndex(
    pages=(
        HelpPage(
            id="features/queries",
            title="Queries",
            description="Write SQL.",
            sections=(
                HelpSection(anchor="parameters", title="Parameters", level=2),
                HelpSection(anchor="wall-mode", title="Wall mode", level=2, enterprise=True),
            ),
        ),
        HelpPage(
            id="features/kpis",
            title="KPIs",
            description="Targets.",
            sections=(HelpSection(anchor="targets", title="Targets", level=2),),
            enterprise=True,
        ),
    )
)


def test_ce_drops_enterprise_pages_and_sections() -> None:
    filtered = for_edition(INDEX, "CE")
    assert filtered is not None
    assert [page.id for page in filtered.pages] == ["features/queries"]
    assert [one.anchor for one in filtered.pages[0].sections] == ["parameters"]


@pytest.mark.parametrize("edition", ["EE", "HUB", None])
def test_ee_and_missing_edition_keep_everything(edition: str | None) -> None:
    assert for_edition(INDEX, edition) == INDEX


def test_a_missing_index_stays_missing() -> None:
    assert for_edition(None, "CE") is None


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


def tool_context(edition: str | None) -> ToolContext:
    async def data_source_id() -> int:
        return 5

    async def draft_exists(draft_id: str) -> bool:
        return False

    async def save_draft(kind: str, draft_id: str | None, payload: dict[str, Any]) -> tuple[str, int]:
        return "d", 1

    return ToolContext(
        datasets=(SPEEDS,),
        data_source_id=data_source_id,
        data_source_info=lambda source_id: None,
        save_draft=save_draft,
        query_draft_exists=draft_exists,
        edition=edition,
    )


def link(**arguments: Any) -> dict[str, Any]:
    return {"type": "tool_use", "id": "c1", "name": "link_help", "input": arguments}


async def test_link_help_refuses_filtered_page_on_ce(docs_index: Path) -> None:
    refused = await prepare_call(link(page="features/kpis", reason="x"), tool_context("CE"))
    assert isinstance(refused, Immediate) and refused.is_error and refused.frame is None
    assert "features/kpis" not in refused.content.split("Pages that may fit")[-1]
    allowed = await prepare_call(link(page="features/kpis", reason="x"), tool_context("EE"))
    assert isinstance(allowed, Immediate) and not allowed.is_error


async def test_link_help_refuses_a_filtered_section_on_ce(docs_index: Path) -> None:
    refused = await prepare_call(link(page="features/queries", section="wall-mode", reason="x"), tool_context("CE"))
    assert isinstance(refused, Immediate) and refused.is_error
    allowed = await prepare_call(link(page="features/queries", section="wall-mode", reason="x"), tool_context(None))
    assert isinstance(allowed, Immediate) and not allowed.is_error


def test_the_community_prompt_leaves_enterprise_docs_out(docs_index: Path) -> None:
    def text(edition: str) -> str:
        instance = ChatInstanceIn.model_validate({"name": "Town", "edition": edition})
        blocks = chat_system((SPEEDS,), omitted_history=False, context=TurnContext(instance, None, ()))
        return "\n".join(block["text"] for block in blocks)

    community = text("CE")
    assert "features/queries" in community
    assert "features/kpis" not in community
    assert "wall-mode" not in community
    enterprise = text("EE")
    assert "features/kpis" in enterprise and "wall-mode" in enterprise


def test_the_index_file_keeps_the_markers(docs_index: Path) -> None:
    raw = json.loads(docs_index.read_text())
    kpis = next(page for page in raw["pages"] if page["id"] == "features/kpis")
    assert kpis["enterprise"] is True


def docs_tree(tmp_path: Path) -> Path:
    root = tmp_path / "site-docs"
    for relative, text in PAGES.items():
        (root / relative).parent.mkdir(parents=True, exist_ok=True)
        (root / relative).write_text(text)
    return root


def test_build_reads_front_matter_markers(tmp_path: Path) -> None:
    built = {page["id"]: page for page in build_index(docs_tree(tmp_path))["pages"]}
    assert built["features/kpis"]["enterprise"] is True
    assert "enterprise" not in built["features/queries"]
    sections = {one["anchor"]: one for one in built["features/queries"]["sections"]}
    assert sections["wall-mode"]["enterprise"] is True
    assert "enterprise" not in sections["parameters"]


def test_build_reads_block_list_enterprise_sections(tmp_path: Path) -> None:
    root = tmp_path / "block"
    root.mkdir()
    (root / "d.md").write_text(
        "---\ntitle: D\nenterprise_sections:\n  - wall-mode\n  - 'presentation-mode'\n---\n\n"
        "## Wall mode\n\n## Presentation mode\n\n## Grid\n"
    )
    sections = {one["anchor"]: one for one in build_index(root)["pages"][0]["sections"]}
    assert sections["wall-mode"]["enterprise"] is True
    assert sections["presentation-mode"]["enterprise"] is True
    assert "enterprise" not in sections["grid"]


def test_unmarked_pages_render_exactly_as_before(tmp_path: Path) -> None:
    root = tmp_path / "plain"
    root.mkdir()
    (root / "a.md").write_text("---\ntitle: A\n---\n\n## One\n")
    assert build_index(root) == {
        "pages": [
            {"id": "a", "title": "A", "description": "", "sections": [{"anchor": "one", "title": "One", "level": 2}]}
        ]
    }


def test_build_accepts_docs_and_out_paths(tmp_path: Path) -> None:
    out = tmp_path / "composed" / "index.json"
    out.parent.mkdir()
    assert help_index.main(["build", "--docs", str(docs_tree(tmp_path)), "--out", str(out)]) == 0
    assert {page["id"] for page in json.loads(out.read_text())["pages"]} == {"features/queries", "features/kpis"}
    assert help_index.main(["check", "--docs", str(tmp_path / "site-docs"), "--out", str(out)]) == 0


def test_the_two_argument_form_still_writes_the_committed_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "index.json"
    monkeypatch.setattr(help_index, "INDEX_PATH", target)
    assert help_index.main(["build", str(docs_tree(tmp_path))]) == 0
    assert target.exists()
    assert help_index.main(["check", str(tmp_path / "site-docs")]) == 0


def test_bad_arguments_are_a_usage_error() -> None:
    assert help_index.main(["build"]) == 2
    assert help_index.main(["nonsense", "x"]) == 2


def test_a_marked_section_carries_to_its_subordinate_headings(tmp_path: Path) -> None:
    root = tmp_path / "nested"
    root.mkdir()
    (root / "a.md").write_text(
        "---\ntitle: A\nenterprise_sections: [wall]\n---\n\n"
        "## Wall {#wall}\n\n### Child\n\n## Open\n\n### Open child\n"
    )
    [page] = build_index(root)["pages"]
    flags = {one["anchor"]: one.get("enterprise", False) for one in page["sections"]}
    assert flags == {"wall": True, "child": True, "open": False, "open-child": False}
