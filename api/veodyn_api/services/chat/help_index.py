import difflib
import json
import logging
import re
import sys
import unicodedata
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

INDEX_PATH = Path(__file__).with_name("help_index.json")
MAX_INDEX_BYTES = 64_000
PROMPT_HEADER = "Veodyn documentation (page | title | about, then its sections as #anchor title):"

HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*$")
CLOSING_HASHES_RE = re.compile(r"\s+#+$")
EXPLICIT_ID_RE = re.compile(r"\s*\{#([^}\s]+)\}$")
FENCE_RE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
IMAGE_OR_LINK_RE = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
HTML_TAG_RE = re.compile(r"<[^>]+>")
UNDERSCORE_EMPHASIS_RE = re.compile(r"(?<!\w)_{1,2}(.+?)_{1,2}(?!\w)")
ESCAPE_RE = re.compile(r"\\(.)")


class IndexTooLarge(ValueError):
    pass


@dataclass(frozen=True)
class HelpSection:
    anchor: str
    title: str
    level: int


@dataclass(frozen=True)
class HelpPage:
    id: str
    title: str
    description: str
    sections: tuple[HelpSection, ...]

    def section(self, anchor: str) -> HelpSection | None:
        return next((one for one in self.sections if one.anchor == anchor), None)


@dataclass(frozen=True)
class HelpIndex:
    pages: tuple[HelpPage, ...]

    def page(self, page_id: str) -> HelpPage | None:
        return next((one for one in self.pages if one.id == page_id), None)


def slugify(text: str) -> str:
    kept = (
        char
        for char in text.lower()
        if char in " -" or unicodedata.category(char)[0] in "LMN" or unicodedata.category(char) == "Pc"
    )
    return "".join(kept).replace(" ", "-")


def plain_text(markdown: str) -> str:
    text = IMAGE_OR_LINK_RE.sub(r"\1", markdown)
    text = HTML_TAG_RE.sub("", text)
    text = text.replace("`", "").replace("*", "")
    text = UNDERSCORE_EMPHASIS_RE.sub(r"\1", text)
    return ESCAPE_RE.sub(r"\1", text).strip()


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] == '"':
        return str(json.loads(value))
    if len(value) >= 2 and value[0] == value[-1] == "'":
        return value[1:-1].replace("''", "'")
    return value


def _split_frontmatter(text: str) -> tuple[dict[str, str], list[str]]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, lines
    for end, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            fields = {}
            for entry in lines[1:end]:
                key, colon, value = entry.partition(":")
                if colon and key.strip() and not key.startswith((" ", "\t")):
                    fields[key.strip()] = _unquote(value)
            return fields, lines[end + 1 :]
    return {}, lines


def _headings(body: list[str]) -> Iterator[tuple[int, str]]:
    fence: str | None = None
    for line in body:
        opened = FENCE_RE.match(line)
        if fence is not None:
            if opened and opened.group(1)[0] == fence[0] and len(opened.group(1)) >= len(fence):
                fence = None
            continue
        if opened:
            fence = opened.group(1)
            continue
        found = HEADING_RE.match(line)
        if found:
            yield len(found.group(1)), CLOSING_HASHES_RE.sub("", found.group(2))


def parse_page(relative: str, text: str) -> dict[str, Any]:
    fields, body = _split_frontmatter(text)
    slug = fields.get("slug")
    page_id = slug.strip("/") if slug is not None else relative.removesuffix(".md")
    title = fields.get("title", "")
    sections: list[dict[str, Any]] = []
    seen: dict[str, int] = {}
    for level, raw in _headings(body):
        explicit = EXPLICIT_ID_RE.search(raw)
        shown = plain_text(raw[: explicit.start()] if explicit else raw)
        if explicit:
            anchor = explicit.group(1)
        else:
            base = slugify(shown)
            anchor = base
            while anchor in seen:
                seen[base] += 1
                anchor = f"{base}-{seen[base]}"
            seen[anchor] = 0
        if level == 1 and not title:
            title = shown
        if level in (2, 3):
            sections.append({"anchor": anchor, "title": shown, "level": level})
    return {"id": page_id, "title": title, "description": fields.get("description", ""), "sections": sections}


def build_index(docs_dir: Path) -> dict[str, Any]:
    found = [parse_page(path.relative_to(docs_dir).as_posix(), path.read_text()) for path in docs_dir.rglob("*.md")]
    return {"pages": sorted(found, key=lambda page: page["id"])}


def render(index: dict[str, Any]) -> str:
    rendered = json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n"
    size = len(rendered.encode())
    if size > MAX_INDEX_BYTES:
        raise IndexTooLarge(f"the help index is {size} bytes, over the {MAX_INDEX_BYTES} byte cap")
    return rendered


def _pretty(index: Any) -> list[str]:
    return json.dumps(index, ensure_ascii=False, indent=1).splitlines()


def drift(docs_dir: Path, index_path: Path) -> list[str]:
    expected = _pretty(json.loads(render(build_index(docs_dir))))
    try:
        committed = _pretty(json.loads(index_path.read_text()))
    except (OSError, ValueError):
        committed = []
    if committed == expected:
        return []
    return list(difflib.unified_diff(committed, expected, str(index_path), "generated from the docs", lineterm=""))


def _from_json(raw: dict[str, Any]) -> HelpIndex:
    return HelpIndex(
        pages=tuple(
            HelpPage(
                id=str(page["id"]),
                title=str(page["title"]),
                description=str(page["description"]),
                sections=tuple(
                    HelpSection(anchor=str(one["anchor"]), title=str(one["title"]), level=int(one["level"]))
                    for one in page["sections"]
                ),
            )
            for page in raw["pages"]
        )
    )


@lru_cache(maxsize=1)
def load_index() -> HelpIndex | None:
    try:
        return _from_json(json.loads(INDEX_PATH.read_text()))
    except (OSError, ValueError, KeyError, TypeError):
        logger.warning("the documentation index could not be read; the chat will not link to the docs", exc_info=True)
        return None


def shown_id(page_id: str) -> str:
    return page_id or "/"


def prompt_block(index: HelpIndex) -> str:
    lines = [PROMPT_HEADER]
    for page in index.pages:
        lines.append(f"{shown_id(page.id)} | {page.title} | {page.description}")
        lines.extend(f"{'  ' * (one.level - 1)}#{one.anchor} {one.title}" for one in page.sections)
    return "\n".join(lines)


def page_url(docs_url: str, page_id: str) -> str:
    base = docs_url.rstrip("/")
    return f"{base}/{page_id}/" if page_id else f"{base}/"


def missing_anchors(index: HelpIndex, docs_url: str, fetch: Callable[[str], str]) -> list[str]:
    missing: list[str] = []
    for page in index.pages:
        html = fetch(page_url(docs_url, page.id))
        missing.extend(f"{page.id}#{one.anchor}" for one in page.sections if f'id="{one.anchor}"' not in html)
    return missing


def _fetch(url: str) -> str:
    import httpx

    response = httpx.get(url, follow_redirects=True, timeout=30.0)
    response.raise_for_status()
    return response.text


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[0] not in ("build", "check", "verify"):
        print("usage: help_index build|check <docs dir> | verify <docs url>", file=sys.stderr)
        return 2
    command, target = argv
    if command == "build":
        INDEX_PATH.write_text(render(build_index(Path(target))))
        print(f"wrote {INDEX_PATH}")
        return 0
    if command == "check":
        lines = drift(Path(target), INDEX_PATH)
        for line in lines:
            print(line)
        if lines:
            print("the help index is stale: run `python -m veodyn_api.services.chat.help_index build ../docs/docs`")
        return 1 if lines else 0
    index = load_index()
    if index is None:
        return 1
    missing = missing_anchors(index, target, _fetch)
    for one in missing:
        print(f"missing on the site: {one}")
    print(f"{len(missing)} of {sum(len(page.sections) for page in index.pages)} anchors missing")
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
