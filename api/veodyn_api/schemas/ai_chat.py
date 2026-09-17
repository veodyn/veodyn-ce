from datetime import datetime
from typing import Annotated, Any, Literal

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


Tag = Annotated[str, Field(max_length=64)]


class _ChatResultBase(CamelModel):
    ok: bool
    error: str | None = Field(default=None, max_length=500)


class _ChatRowsBase(_ChatResultBase):
    row_count: int | None = Field(default=None, ge=0)
    truncated: bool | None = None
    columns: list[ChatResultColumnIn] | None = Field(default=None, max_length=500)
    sample: list[dict[str, Any]] | None = Field(default=None, max_length=50)


class ChatQueryResultIn(_ChatRowsBase):
    kind: Literal["query_result"]


class ChatLibraryItemIn(CamelModel):
    type: Literal["query", "dashboard"]
    id: int = Field(gt=0)
    name: str = Field(max_length=500)
    description: str | None = Field(default=None, max_length=300)
    tags: list[Tag] = Field(default_factory=list, max_length=10)
    updated_at: str | None = Field(default=None, max_length=64)
    has_result: bool | None = None


class ChatLibraryResultIn(_ChatResultBase):
    kind: Literal["library"]
    items: list[ChatLibraryItemIn] | None = Field(default=None, max_length=20)
    more: bool | None = None


class ChatSavedQueryIn(CamelModel):
    id: int = Field(gt=0)
    name: str = Field(max_length=500)
    description: str | None = Field(default=None, max_length=4_000)
    sql: str | None = Field(default=None, max_length=8_000)
    data_source_id: int | None = Field(default=None, gt=0)
    parameters: list[Annotated[str, Field(max_length=255)]] = Field(default_factory=list, max_length=50)
    updated_at: str | None = Field(default=None, max_length=64)


class ChatVisualizationRefIn(CamelModel):
    id: int = Field(gt=0)
    name: str = Field(max_length=500)
    type: str = Field(max_length=64)


class ChatSavedVisualizationResultIn(_ChatRowsBase):
    kind: Literal["saved_visualization"]
    query: ChatSavedQueryIn | None = None
    visualization: ChatVisualizationRefIn | None = None
    visualizations: list[ChatVisualizationRefIn] | None = Field(default=None, max_length=20)
    retrieved_at: str | None = Field(default=None, max_length=64)


class ChatDashboardRefIn(CamelModel):
    id: int = Field(gt=0)
    name: str = Field(max_length=500)
    tags: list[Tag] = Field(default_factory=list, max_length=10)
    updated_at: str | None = Field(default=None, max_length=64)


class ChatDashboardWidgetIn(CamelModel):
    title: str = Field(max_length=500)
    query_id: int = Field(gt=0)
    query_name: str | None = Field(default=None, max_length=500)
    visualization_id: int = Field(gt=0)
    visualization_type: str = Field(max_length=64)


class ChatDashboardResultIn(_ChatResultBase):
    kind: Literal["dashboard"]
    dashboard: ChatDashboardRefIn | None = None
    widgets: list[ChatDashboardWidgetIn] | None = Field(default=None, max_length=50)
    text_widgets: int | None = Field(default=None, ge=0)


ChatToolResultIn = Annotated[
    ChatQueryResultIn | ChatLibraryResultIn | ChatSavedVisualizationResultIn | ChatDashboardResultIn,
    Field(discriminator="kind"),
]


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
