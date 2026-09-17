from datetime import datetime
from typing import Any, Literal

from pydantic import Field

from veodyn_api.schemas.ai import CamelModel

MAX_MESSAGE_CHARS = 4_000


class ChatThreadOut(CamelModel):
    id: str
    title: str
    pinned: bool
    created_at: datetime
    updated_at: datetime
    last_turn_at: datetime


class ChatThreadListOut(CamelModel):
    threads: list[ChatThreadOut]
    next_offset: int | None


class ChatThreadPatchIn(CamelModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    pinned: bool | None = None


class ChatTurnIn(CamelModel):
    text: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)


class ChatTurnStartedOut(CamelModel):
    turn_id: str
    seq: int


class ChatTurnOut(CamelModel):
    id: str
    seq: int
    status: Literal["running", "done", "failed"]
    user_text: str
    blocks: list[dict[str, Any]]
    stop_reason: str | None
    error_id: str | None
    created_at: datetime
    finished_at: datetime | None


class ChatDraftVersionOut(CamelModel):
    version: int
    turn_id: str
    payload: dict[str, Any]
    created_at: datetime


class ChatPromotionOut(CamelModel):
    id: str
    target_type: str
    target_id: str
    promoted_version: int
    target_version_at_promote: int | None
    created_at: datetime


class ChatDraftOut(CamelModel):
    id: str
    kind: str
    versions: list[ChatDraftVersionOut]
    promotions: list[ChatPromotionOut]


class ChatThreadDetailOut(CamelModel):
    thread: ChatThreadOut
    turns: list[ChatTurnOut]
    drafts: list[ChatDraftOut]


class ChatResultColumnIn(CamelModel):
    name: str = Field(max_length=255)
    type: str = Field(max_length=64)
    nulls: int = Field(ge=0)
    distinct: int = Field(ge=0)
    distinct_capped: bool = False
    min: Any = None
    max: Any = None
    top: list[dict[str, Any]] | None = Field(default=None, max_length=3)


class ChatToolResultIn(CamelModel):
    ok: bool
    error: str | None = Field(default=None, max_length=500)
    row_count: int | None = Field(default=None, ge=0)
    truncated: bool | None = None
    columns: list[ChatResultColumnIn] | None = Field(default=None, max_length=500)
    sample: list[dict[str, Any]] | None = Field(default=None, max_length=50)


class ChatToolResultPostIn(CamelModel):
    call_id: str = Field(min_length=1, max_length=128)
    result: ChatToolResultIn


class ChatAcceptedOut(CamelModel):
    accepted: bool


class ChatPromotionIn(CamelModel):
    version: int = Field(ge=1)
    target_type: Literal["query"]
    target_id: str = Field(min_length=1, max_length=64)
    target_version_at_promote: int | None = Field(default=None, ge=0)
