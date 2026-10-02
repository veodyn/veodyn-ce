import json
from pathlib import Path

import pytest

from veodyn_api.services.chat import help_index
from veodyn_api.services.chat.help_index import (
    HelpIndex,
    IndexTooLarge,
    build_index,
    drift,
    load_index,
    missing_anchors,
    page_url,
    prompt_block,
    render,
    slugify,
)

REPO_DOCS = Path(__file__).resolve().parents[2] / "docs" / "docs"

QUERIES = """---
sidebar_position: 3
title: Queries
description: "Write, run and schedule SQL: the \\"editor\\"."
---

# Queries

## The query list

## Parameters

### Date ranges

```sql
## not a heading
SELECT 1
```

## Parameters

## Sharing a [dashboard](/features/dashboards) with `API keys` and **bold** text

## Wall mode (enterprise) {#wall-mode}

#### Too deep to list
"""

INTRO = """---
slug: /
title: 'Documentation'
---

# Veodyn

## What a node is
"""

UNTITLED = """# Captures without a title

## Stale captures
"""

USE_CASES = """---
slug: /use-cases
title: Use cases
description: Worked examples.
---
"""


def write_tree(root: Path) -> Path:
    files = {
        "features/queries.md": QUERIES,
        "intro.md": INTRO,
        "features/captures.md": UNTITLED,
        "use-cases/index.md": USE_CASES,
        "features/notes.txt": "## ignored",
    }
    for relative, text in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    return root


@pytest.fixture
def tree(tmp_path: Path) -> Path:
    return write_tree(tmp_path / "docs")


@pytest.fixture
def index_file(tmp_path: Path, tree: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "help_index.json"
    path.write_text(render(build_index(tree)))
    monkeypatch.setattr(help_index, "INDEX_PATH", path)
    load_index.cache_clear()
    yield path
    load_index.cache_clear()


def pages(tree: Path) -> dict[str, dict]:
    return {page["id"]: page for page in build_index(tree)["pages"]}


def test_page_ids_come_from_the_slug_or_the_path(tree: Path) -> None:
    assert [page["id"] for page in build_index(tree)["pages"]] == [
        "",
        "features/captures",
        "features/queries",
        "use-cases",
    ]


def test_titles_and_descriptions_come_from_frontmatter_or_the_first_heading(tree: Path) -> None:
    found = pages(tree)
    assert found["features/queries"]["title"] == "Queries"
    assert found["features/queries"]["description"] == 'Write, run and schedule SQL: the "editor".'
    assert found[""]["title"] == "Documentation"
    assert found["features/captures"]["title"] == "Captures without a title"
    assert found["features/captures"]["description"] == ""


def test_sections_keep_order_level_and_skip_code_fences(tree: Path) -> None:
    sections = pages(tree)["features/queries"]["sections"]
    assert sections == [
        {"anchor": "the-query-list", "title": "The query list", "level": 2},
        {"anchor": "parameters", "title": "Parameters", "level": 2},
        {"anchor": "date-ranges", "title": "Date ranges", "level": 3},
        {"anchor": "parameters-1", "title": "Parameters", "level": 2},
        {
            "anchor": "sharing-a-dashboard-with-api-keys-and-bold-text",
            "title": "Sharing a dashboard with API keys and bold text",
            "level": 2,
        },
        {"anchor": "wall-mode", "title": "Wall mode (enterprise)", "level": 2},
    ]


def test_the_page_title_heading_takes_part_in_duplicate_counting(tmp_path: Path) -> None:
    root = tmp_path / "docs"
    root.mkdir()
    (root / "alerts.md").write_text("# Alerts\n\n## Alerts\n")
    [page] = build_index(root)["pages"]
    assert page["sections"] == [{"anchor": "alerts-1", "title": "Alerts", "level": 2}]


@pytest.mark.parametrize(
    ("text", "slug"),
    [
        ("The query list", "the-query-list"),
        (
            "5. Optional: the veodyn-api sidecar (catalog, tags, feeds, AI)",
            "5-optional-the-veodyn-api-sidecar-catalog-tags-feeds-ai",
        ),
        ("since and limit are applied", "since-and-limit-are-applied"),
        ("message_type_id, soap_action", "message_type_id-soap_action"),
        ("Library → Queries", "library--queries"),
        ("Édition  spéciale", "édition--spéciale"),
    ],
)
def test_slugs_follow_github_slugger(text: str, slug: str) -> None:
    assert slugify(text) == slug


def test_render_is_compact_sorted_json_and_refuses_to_grow_past_the_cap(tree: Path) -> None:
    rendered = render(build_index(tree))
    assert "\n" not in rendered.strip()
    assert json.loads(rendered)["pages"][0]["id"] == ""
    huge = {"pages": [{"id": "x", "title": "x" * help_index.MAX_INDEX_BYTES, "description": "", "sections": []}]}
    with pytest.raises(IndexTooLarge):
        render(huge)


def test_drift_is_empty_when_the_file_matches_and_names_the_change_otherwise(tree: Path, tmp_path: Path) -> None:
    path = tmp_path / "index.json"
    path.write_text(render(build_index(tree)))
    assert drift(tree, path) == []
    (tree / "features/queries.md").write_text(QUERIES + "\n## Forking\n")
    assert any("forking" in line for line in drift(tree, path))
    assert drift(tree, tmp_path / "missing.json") != []


def test_the_committed_index_matches_the_docs() -> None:
    assert drift(REPO_DOCS, help_index.INDEX_PATH) == []


def test_load_index_reads_the_file_once(index_file: Path) -> None:
    loaded = load_index()
    assert isinstance(loaded, HelpIndex)
    assert loaded.page("features/queries") is not None
    index_file.unlink()
    assert load_index() is loaded


def test_a_missing_index_loads_as_none(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(help_index, "INDEX_PATH", tmp_path / "absent.json")
    load_index.cache_clear()
    try:
        assert load_index() is None
    finally:
        load_index.cache_clear()


def test_the_prompt_block_lists_pages_and_indents_sections(index_file: Path) -> None:
    loaded = load_index()
    assert loaded is not None
    block = prompt_block(loaded)
    assert block.startswith("Veodyn documentation (page | title | about, then its sections as #anchor title):")
    assert "\n/ | Documentation | \n  #what-a-node-is What a node is\n" in block
    assert "\nfeatures/queries | Queries | Write, run" in block
    assert "\n  #parameters Parameters\n    #date-ranges Date ranges\n" in block
    assert "#wall-mode Wall mode (enterprise)" in block


def test_page_urls_follow_the_trailing_slash_site() -> None:
    assert page_url("https://docs.example.com/docs/", "features/queries") == (
        "https://docs.example.com/docs/features/queries/"
    )
    assert page_url("https://docs.example.com/docs", "") == "https://docs.example.com/docs/"


def test_verify_reports_anchors_the_site_does_not_have(index_file: Path) -> None:
    loaded = load_index()
    assert loaded is not None
    fetched: list[str] = []

    def fetch(url: str) -> str:
        fetched.append(url)
        return '<h2 id="the-query-list">x</h2><h2 id="parameters">' if url.endswith("queries/") else ""

    missing = missing_anchors(loaded, "https://site/docs", fetch)
    assert "https://site/docs/features/queries/" in fetched
    assert "features/queries#the-query-list" not in missing
    assert "features/queries#date-ranges" in missing
    assert "#what-a-node-is" in missing
