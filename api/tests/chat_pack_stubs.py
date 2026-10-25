from typing import Any

from tests.test_chat_tools import Drafts, context
from veodyn_api.services.chat.tools import ToolContext


def pack_context(drafts: Drafts | None = None, **kwargs: Any) -> ToolContext:
    built = context(drafts, **kwargs)
    built.edition = "EE"
    built.features = ("query_snippets", "kpis", "reports", "messages")
    return built
