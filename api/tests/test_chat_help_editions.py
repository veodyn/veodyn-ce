import re
from pathlib import Path

import yaml

DOCS = Path(__file__).resolve().parents[2] / "docs" / "docs"
LINK = re.compile(r"\]\(/(features/[a-z0-9-]+)(?:#([a-z0-9-]+))?\)")


def front_matter(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    _, block, _ = text.split("---", 2)
    return yaml.safe_load(block) or {}


def enterprise_only_links() -> list[tuple[str, str | None]]:
    links = []
    for line in (DOCS / "editions.md").read_text(encoding="utf-8").splitlines():
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if not line.startswith("|") or len(cells) < 4:
            continue
        community, enterprise = cells[-2], cells[-1]
        if community or not enterprise:
            continue
        for page, anchor in LINK.findall(cells[-3]):
            links.append((page, anchor or None))
    return links


def test_editions_table_yields_enterprise_links():
    assert ("features/managed-datasets", None) in enterprise_only_links()
    assert ("features/kpis", "what-a-kpi-can-measure") in enterprise_only_links()


def test_every_enterprise_row_in_editions_has_a_marked_page_or_section():
    unmarked = []
    for page, anchor in enterprise_only_links():
        meta = front_matter(DOCS / f"{page}.md")
        if meta.get("edition") == "enterprise":
            continue
        if anchor and anchor in (meta.get("enterprise_sections") or []):
            continue
        unmarked.append(f"{page}#{anchor}" if anchor else page)
    assert unmarked == []
