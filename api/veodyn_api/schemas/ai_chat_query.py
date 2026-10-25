from typing import Any, Literal

from pydantic import Field

from veodyn_api.schemas.ai import CamelModel
from veodyn_api.schemas.ai_chat_result_base import ChatResultBase, ChatVisualizationRefIn, Tag

MAX_SQL_CHARS = 50_000
MAX_DESCRIPTION_CHARS = 4_096
MAX_PARAMETER_DEFINITIONS = 20
MAX_QUERY_TAGS = 20
MAX_QUERY_VISUALIZATIONS = 20
MAX_CHANGED_FIELDS = 8


class ChatQuerySnapshotIn(CamelModel):
    id: int = Field(gt=0)
    name: str = Field(max_length=500)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION_CHARS)
    sql: str = Field(max_length=MAX_SQL_CHARS)
    data_source_id: int = Field(gt=0)
    parameters: list[dict[str, Any]] = Field(default_factory=list, max_length=MAX_PARAMETER_DEFINITIONS)
    tags: list[Tag] = Field(default_factory=list, max_length=MAX_QUERY_TAGS)
    schedule: dict[str, Any] | None = None
    is_draft: bool
    updated_at: str = Field(max_length=64)


class ChatQueryDetailIn(ChatQuerySnapshotIn):
    can_edit: bool
    visualizations: list[ChatVisualizationRefIn] = Field(default_factory=list, max_length=MAX_QUERY_VISUALIZATIONS)


class ChatQueryDetailResultIn(ChatResultBase):
    kind: Literal["query_detail"]
    query: ChatQueryDetailIn | None = None


class ChatQueryEditResultIn(ChatResultBase):
    kind: Literal["query_edit"]
    query_id: int | None = Field(default=None, gt=0)
    snapshot: ChatQuerySnapshotIn | None = None
    changes: dict[str, Any] | None = Field(default=None, max_length=MAX_CHANGED_FIELDS)
