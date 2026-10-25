from typing import Literal

from pydantic import Field

from veodyn_api.schemas.ai import CamelModel
from veodyn_api.schemas.ai_chat_result_base import ChatResultBase, Tag


class ChatLibraryItemIn(CamelModel):
    type: Literal["query", "dashboard"]
    id: int = Field(gt=0)
    name: str = Field(max_length=500)
    description: str | None = Field(default=None, max_length=300)
    tags: list[Tag] = Field(default_factory=list, max_length=10)
    updated_at: str | None = Field(default=None, max_length=64)
    has_result: bool | None = None
    archived: bool | None = None


class ChatLibraryTagCountIn(CamelModel):
    kind: Literal["query", "dashboard"]
    name: Tag
    count: int = Field(ge=0)


class ChatLibraryResultIn(ChatResultBase):
    kind: Literal["library"]
    items: list[ChatLibraryItemIn] | None = Field(default=None, max_length=60)
    more: bool | None = None
    query_count: int | None = Field(default=None, ge=0)
    dashboard_count: int | None = Field(default=None, ge=0)
    tag_counts: list[ChatLibraryTagCountIn] | None = Field(default=None, max_length=50)
