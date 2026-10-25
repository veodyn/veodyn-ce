from typing import Annotated, Any, Literal

from pydantic import Field

from veodyn_api.schemas.ai import CamelModel
from veodyn_api.schemas.ai_chat_result_base import ChatResultBase

MAX_SNIPPET_TRIGGER_CHARS = 255
MAX_SNIPPET_BODY_CHARS = 10_000
MAX_SNIPPET_DESCRIPTION_CHARS = 1_000
MAX_CHECKED_COLUMNS = 500


class ChatSnippetSnapshotIn(CamelModel):
    trigger: str = Field(max_length=MAX_SNIPPET_TRIGGER_CHARS)
    snippet: str = Field(max_length=MAX_SNIPPET_BODY_CHARS)
    description: str | None = Field(default=None, max_length=MAX_SNIPPET_DESCRIPTION_CHARS)
    updated_at: str = Field(max_length=64)


class ChatSnippetCheckResultIn(ChatResultBase):
    kind: Literal["snippet_check"]
    mode: Literal["edit", "delete"] | None = None
    snippet_id: int | None = Field(default=None, gt=0)
    snapshot: ChatSnippetSnapshotIn | None = None
    changes: dict[str, Any] | None = Field(default=None, max_length=3)


class ChatKpiCheckResultIn(ChatResultBase):
    kind: Literal["kpi_check"]
    source_query_id: int | None = Field(default=None, gt=0)
    query_draft_id: str | None = Field(default=None, max_length=64)
    query_name: str | None = Field(default=None, max_length=500)
    columns: list[Annotated[str, Field(max_length=255)]] = Field(default_factory=list, max_length=MAX_CHECKED_COLUMNS)
