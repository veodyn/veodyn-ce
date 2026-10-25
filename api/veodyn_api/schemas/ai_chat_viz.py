from typing import Any, Literal

from pydantic import Field

from veodyn_api.schemas.ai import CamelModel
from veodyn_api.schemas.ai_chat_result_base import ChatResultBase

MAX_TYPE_OPTIONS = 80
MAX_VIZ_PROBLEMS = 20


class ChatVizTypeResultIn(ChatResultBase):
    kind: Literal["visualization_type"]
    type: str | None = Field(default=None, max_length=64)
    label: str | None = Field(default=None, max_length=200)
    options: list[dict[str, Any]] | None = Field(default=None, max_length=MAX_TYPE_OPTIONS)


class ChatVizSnapshotIn(CamelModel):
    type: str = Field(max_length=64)
    name: str = Field(max_length=500)
    options: dict[str, Any]
    updated_at: str = Field(max_length=64)


class ChatVizNextIn(CamelModel):
    type: str = Field(max_length=64)
    name: str = Field(max_length=500)
    options: dict[str, Any]


class ChatVizCheckResultIn(ChatResultBase):
    kind: Literal["visualization_check"]
    mode: Literal["new", "edit", "delete"] | None = None
    query_id: int | None = Field(default=None, gt=0)
    visualization_id: int | None = Field(default=None, gt=0)
    snapshot: ChatVizSnapshotIn | None = None
    next: ChatVizNextIn | None = None
    problems: list[str] = Field(default_factory=list, max_length=MAX_VIZ_PROBLEMS)
