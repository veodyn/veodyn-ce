from datetime import datetime
from typing import Any, Literal

from pydantic import ConfigDict, Field, SerializerFunctionWrapHandler, model_serializer, model_validator

from veodyn_api.schemas.ai import CamelModel
from veodyn_api.schemas.ai_chat_context import SubjectKind

ThreadOrigin = Literal["chat", "mcp"]


SUBJECT_REQUIRED: dict[str, tuple[str, ...]] = {
    "query": ("query_id",),
    "visualization": ("query_id", "visualization_id"),
    "dashboard": ("dashboard_id",),
    "widget": ("dashboard_id", "widget_id"),
    "dataset": ("dataset_id",),
    "new": ("new_kind",),
}


class ChatThreadSubject(CamelModel):
    model_config = ConfigDict(extra="forbid")

    kind: SubjectKind
    query_id: int | None = Field(default=None, gt=0)
    visualization_id: int | None = Field(default=None, gt=0)
    dashboard_id: int | None = Field(default=None, gt=0)
    widget_id: int | None = Field(default=None, gt=0)
    dataset_id: str | None = Field(default=None, min_length=1, max_length=200)
    new_kind: Literal["query", "dashboard", "snippet", "kpi", "report", "message"] | None = None

    @model_serializer(mode="wrap")
    def _without_unset_fields(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        return {key: value for key, value in handler(self).items() if value is not None}

    @model_validator(mode="after")
    def _has_what_its_kind_needs(self) -> "ChatThreadSubject":
        missing = [name for name in SUBJECT_REQUIRED[self.kind] if getattr(self, name) is None]
        if missing:
            raise ValueError(f"a {self.kind} subject needs {', '.join(missing)}")
        return self


class ChatThreadCreateIn(CamelModel):
    model_config = ConfigDict(extra="forbid")

    subject: ChatThreadSubject | None = None


class ChatThreadSubjectOut(CamelModel):
    subject: ChatThreadSubject | None


class ChatThreadOut(CamelModel):
    id: str
    title: str
    pinned: bool
    origin: ThreadOrigin
    subject: ChatThreadSubject | None = None
    created_at: datetime
    updated_at: datetime
    last_turn_at: datetime


class ChatThreadListOut(CamelModel):
    threads: list[ChatThreadOut]
    next_offset: int | None


class ChatThreadPatchIn(CamelModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    pinned: bool | None = None


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
    last_event_id: str | None = None


class ChatDraftVersionOut(CamelModel):
    version: int
    turn_id: str
    payload: dict[str, Any]
    created_at: datetime


PromotionStatus = Literal["pending", "partial", "done", "failed"]
FINISHED_STATUSES: frozenset[str] = frozenset({"done", "partial"})


class ChatPromotionReceipt(CamelModel):
    step: int = Field(ge=0)
    outcome: Literal["done", "failed", "skipped"]
    target_id: str | None = Field(default=None, max_length=64)
    updated_at: str | None = Field(default=None, max_length=64)
    error: str | None = Field(default=None, max_length=500)


class ChatPromotionOut(CamelModel):
    id: str
    target_type: str
    target_id: str | None
    status: PromotionStatus
    receipts: list[ChatPromotionReceipt]
    promoted_version: int
    target_version_at_promote: int | None
    created_at: datetime
    updated_at: datetime


class ChatDraftOut(CamelModel):
    id: str
    kind: str
    versions: list[ChatDraftVersionOut]
    promotions: list[ChatPromotionOut]


class ChatThreadDetailOut(CamelModel):
    thread: ChatThreadOut
    turns: list[ChatTurnOut]
    drafts: list[ChatDraftOut]


class ChatAcceptedOut(CamelModel):
    accepted: bool


class ChatPromotionIn(CamelModel):
    version: int = Field(ge=1)
    target_type: str = Field(min_length=1, max_length=64)
    target_id: str | None = Field(default=None, min_length=1, max_length=64)
    target_version_at_promote: int | None = Field(default=None, ge=0)
    status: PromotionStatus = "done"
    receipts: list[ChatPromotionReceipt] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def _finished_promotions_name_their_target(self) -> "ChatPromotionIn":
        if self.status in FINISHED_STATUSES and self.target_id is None:
            raise ValueError(f"a {self.status} promotion needs a targetId")
        return self


class ChatPromotionPatchIn(CamelModel):
    status: PromotionStatus | None = None
    target_id: str | None = Field(default=None, min_length=1, max_length=64)
    receipts: list[ChatPromotionReceipt] | None = Field(default=None, max_length=50)
    target_version_at_promote: int | None = Field(default=None, ge=0)
