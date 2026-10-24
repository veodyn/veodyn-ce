from dataclasses import replace

from veodyn_api.schemas.ai_chat_context import COMMUNITY, Edition
from veodyn_api.services.chat.help_index import HelpIndex


def for_edition(index: HelpIndex | None, edition: Edition | None) -> HelpIndex | None:
    if index is None or edition != COMMUNITY:
        return index
    return HelpIndex(
        pages=tuple(
            replace(page, sections=tuple(one for one in page.sections if not one.enterprise))
            for page in index.pages
            if not page.enterprise
        )
    )
