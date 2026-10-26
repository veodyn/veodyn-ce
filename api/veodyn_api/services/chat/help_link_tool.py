import json
import re
from typing import Any

from veodyn_api.services.ai_text import text_of
from veodyn_api.services.chat.help_filter import for_edition
from veodyn_api.services.chat.help_index import HelpIndex, load_index, shown_id
from veodyn_api.services.chat.tool_types import ChatTool, ClientCall, Immediate, ToolContext, schema_string

MAX_HELP_LINKS = 3
MAX_HELP_SUGGESTIONS = 5


def _suggested_pages(wanted: str, index: HelpIndex | None) -> list[str]:
    words = {word for word in re.split(r"[^a-z0-9]+", wanted.lower()) if len(word) >= 3}
    scored = [
        (sum(word in f"{page.id} {page.title}".lower() for word in words), shown_id(page.id))
        for page in (index.pages if index else ())
    ]
    best = max((score for score, _ in scored), default=0)
    return [page_id for score, page_id in scored if best and score == best][:MAX_HELP_SUGGESTIONS]


async def _link_help(call_id: str, arguments: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    index = for_edition(load_index(), ctx.edition)
    if index is None:
        return Immediate("the documentation is unavailable on this instance; do not link to it", is_error=True)
    if ctx.help_links >= MAX_HELP_LINKS:
        return Immediate(
            f"you already linked {MAX_HELP_LINKS} documentation sections in this turn. Stop linking and answer.",
            is_error=True,
        )
    asked = arguments.get("page")
    if not isinstance(asked, str) or not asked.strip():
        return Immediate("page must name a page from the documentation index; `/` is the introduction", is_error=True)
    wanted = text_of(asked, 200).strip("/")
    page = index.page(wanted)
    if page is None:
        suggestions = _suggested_pages(wanted, index)
        hint = f" Pages that may fit: {', '.join(suggestions)}." if suggestions else " No page is close to it."
        return Immediate(f"there is no documentation page {wanted!r}.{hint} Use a page from the index.", is_error=True)
    anchor = text_of(arguments.get("section"), 200).lstrip("#") or None
    section = page.section(anchor) if anchor else None
    if anchor and section is None:
        anchors = ", ".join(one.anchor for one in page.sections) or "none"
        return Immediate(
            f"the page {shown_id(page.id)!r} has no section {anchor!r}. Its sections are: {anchors}", is_error=True
        )
    ctx.help_links += 1
    section_title = section.title if section else None
    result = {
        "linked": True,
        "page": page.id,
        "section": anchor,
        "pageTitle": page.title,
        "sectionTitle": section_title,
    }
    card = {
        "callId": call_id,
        "page": page.id,
        "pageTitle": page.title,
        "anchor": anchor,
        "sectionTitle": section_title,
        "reason": text_of(arguments.get("reason"), 200),
    }
    return Immediate(json.dumps(result), is_error=False, frame=("help_link", card))


LINK_HELP = ChatTool(
    name="link_help",
    definition={
        "name": "link_help",
        "description": (
            "Show the analyst a link to a section of the Veodyn documentation. Use it for questions about how the "
            "platform works. The analyst sees the link as a card; do not write URLs yourself."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "page": schema_string("A page from the documentation index, copied exactly. `/` is the introduction."),
                "section": schema_string("An anchor of that page from the index, without `#`. Omit to link the page."),
                "reason": schema_string("What the analyst will find there, in a few words."),
            },
            "required": ["page", "reason"],
        },
    },
    handler=_link_help,
)
