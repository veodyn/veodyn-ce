import json
from typing import Annotated, Any, Literal, get_args

from pydantic import (
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from veodyn_api.schemas.ai import CamelModel
from veodyn_api.schemas.ai_chat_dashboard import (
    MAX_MAPPINGS,
    MAX_TEXT_CHARS,
    ChatDashboardEditResultIn,
    ParameterMappingIn,
    WidgetPositionIn,
)
from veodyn_api.schemas.ai_chat_library import ChatLibraryResultIn
from veodyn_api.schemas.ai_chat_operation import ChatDownloadResultIn, ChatOperationCheckResultIn
from veodyn_api.schemas.ai_chat_proposals import ChatKpiCheckResultIn, ChatSnippetCheckResultIn
from veodyn_api.schemas.ai_chat_query import ChatQueryDetailResultIn, ChatQueryEditResultIn
from veodyn_api.schemas.ai_chat_result_base import ChatResultBase, ChatVisualizationRefIn, Tag
from veodyn_api.schemas.ai_chat_viz import ChatVizCheckResultIn, ChatVizTypeResultIn


class ChatResultColumnIn(CamelModel):
    name: str = Field(max_length=255)
    type: str = Field(max_length=64)
    nulls: int = Field(ge=0)
    distinct: int = Field(ge=0)
    distinct_capped: bool = False
    min: Any = None
    max: Any = None
    top: list[dict[str, Any]] | None = Field(default=None, max_length=3)


class _ChatRowsBase(ChatResultBase):
    row_count: int | None = Field(default=None, ge=0)
    truncated: bool | None = None
    columns: list[ChatResultColumnIn] | None = Field(default=None, max_length=500)
    sample: list[dict[str, Any]] | None = Field(default=None, max_length=50)
    notice: str | None = Field(default=None, max_length=300)


class ChatQueryResultIn(_ChatRowsBase):
    kind: Literal["query_result"]
    data_source_id: int | None = Field(default=None, gt=0)
    saved_query_id: int | None = Field(default=None, gt=0)


class ChatSavedQueryIn(CamelModel):
    id: int = Field(gt=0)
    name: str = Field(max_length=500)
    description: str | None = Field(default=None, max_length=4_000)
    sql: str | None = Field(default=None, max_length=8_000)
    data_source_id: int | None = Field(default=None, gt=0)
    parameters: list[Annotated[str, Field(max_length=255)]] = Field(default_factory=list, max_length=50)
    updated_at: str | None = Field(default=None, max_length=64)
    can_edit: bool | None = None


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
    version: int | None = None
    updated_at: str | None = Field(default=None, max_length=64)
    can_edit: bool | None = None


class ChatDashboardWidgetIn(CamelModel):
    widget_id: int = Field(gt=0)
    kind: Literal["visualization", "text"]
    title: str = Field(max_length=500)
    query_id: int | None = Field(default=None, gt=0)
    query_name: str | None = Field(default=None, max_length=500)
    visualization_id: int | None = Field(default=None, gt=0)
    visualization_type: str | None = Field(default=None, max_length=64)
    text: str | None = Field(default=None, max_length=MAX_TEXT_CHARS)
    position: WidgetPositionIn
    parameter_mappings: dict[Annotated[str, Field(max_length=255)], ParameterMappingIn] | None = Field(
        default=None, max_length=MAX_MAPPINGS
    )
    updated_at: str | None = Field(default=None, max_length=64)


class ChatDashboardResultIn(ChatResultBase):
    kind: Literal["dashboard"]
    dashboard: ChatDashboardRefIn | None = None
    widgets: list[ChatDashboardWidgetIn] | None = Field(default=None, max_length=50)
    widget_count: int | None = Field(default=None, ge=0)
    text_widgets: int | None = Field(default=None, ge=0)


class ChatDataSourceRefIn(CamelModel):
    id: int = Field(gt=0)
    name: str = Field(max_length=500)
    type: str = Field(max_length=64)
    syntax: str = Field(max_length=32)
    view_only: bool = False


class ChatDataSourcesResultIn(ChatResultBase):
    kind: Literal["data_sources"]
    sources: list[ChatDataSourceRefIn] | None = Field(default=None, max_length=50)


class ChatDataSourceTableIn(CamelModel):
    name: str = Field(max_length=255)
    columns: list[Annotated[str, Field(max_length=255)]] = Field(default_factory=list, max_length=100)


class ChatDataSourceResourceIn(CamelModel):
    name: str = Field(max_length=128)
    params: list[Annotated[str, Field(max_length=128)]] = Field(default_factory=list, max_length=50)
    returns: list[Annotated[str, Field(max_length=255)]] = Field(default_factory=list, max_length=50)
    example: str | None = Field(default=None, max_length=500)


class ChatDataSourceSchemaResultIn(ChatResultBase):
    kind: Literal["data_source_schema"]
    data_source_id: int = Field(gt=0)
    syntax: str | None = Field(default=None, max_length=32)
    tables: list[ChatDataSourceTableIn] | None = Field(default=None, max_length=200)
    resources: list[ChatDataSourceResourceIn] | None = Field(default=None, max_length=50)


KpiSlug = Annotated[str, Field(min_length=1, max_length=255, pattern=r"^[A-Za-z0-9._~-]+$")]
MetricStatusName = Literal["on-track", "at-risk", "breached", "no-data"]


class ChatKpiTargetIn(CamelModel):
    value: float
    direction: Literal["higher-is-better", "lower-is-better"]


class ChatKpiThresholdsIn(CamelModel):
    at_risk: float
    breached: float


class ChatKpiRefIn(CamelModel):
    id: KpiSlug
    name: str = Field(max_length=500)
    description: str | None = Field(default=None, max_length=2_000)
    domain: str | None = Field(default=None, max_length=255)
    unit: str | None = Field(default=None, max_length=32)
    cadence: Literal["hourly", "daily", "weekly"] | None = None
    owner: str | None = Field(default=None, max_length=255)
    target: ChatKpiTargetIn | None = None
    thresholds: ChatKpiThresholdsIn | None = None


class ChatKpiEvaluationIn(CamelModel):
    value: float
    status: MetricStatusName
    delta: float | None = None
    as_of: str = Field(max_length=64)
    stale: bool


class ChatKpiPointIn(CamelModel):
    at: str = Field(max_length=64)
    value: float
    status: MetricStatusName


class ChatKpiResultIn(ChatResultBase):
    kind: Literal["kpi"]
    kpi: ChatKpiRefIn | None = None
    evaluation: ChatKpiEvaluationIn | None = None
    history: list[ChatKpiPointIn] | None = Field(default=None, max_length=200)
    last_error: str | None = Field(default=None, max_length=500)
    retrieved_at: str | None = Field(default=None, max_length=64)


class ChatKpiListItemIn(CamelModel):
    id: KpiSlug
    name: str = Field(max_length=500)
    domain: str | None = Field(default=None, max_length=255)
    unit: str | None = Field(default=None, max_length=32)
    value: float | None = None
    status: MetricStatusName
    delta: float | None = None
    as_of: str | None = Field(default=None, max_length=64)
    stale: bool | None = None


class ChatKpiListResultIn(ChatResultBase):
    kind: Literal["kpi_list"]
    items: list[ChatKpiListItemIn] | None = Field(default=None, max_length=50)
    more: bool | None = None


OPEN_RESULT_MAX_BYTES = 64_000
CORE_RESULT_MODELS = (
    ChatQueryResultIn,
    ChatLibraryResultIn,
    ChatSavedVisualizationResultIn,
    ChatDashboardResultIn,
    ChatDashboardEditResultIn,
    ChatDataSourcesResultIn,
    ChatDataSourceSchemaResultIn,
    ChatKpiResultIn,
    ChatKpiListResultIn,
    ChatQueryDetailResultIn,
    ChatQueryEditResultIn,
    ChatVizTypeResultIn,
    ChatVizCheckResultIn,
    ChatSnippetCheckResultIn,
    ChatKpiCheckResultIn,
    ChatOperationCheckResultIn,
    ChatDownloadResultIn,
)
CORE_RESULT_KINDS = frozenset(get_args(model.model_fields["kind"].annotation)[0] for model in CORE_RESULT_MODELS)


class ChatOpenResultIn(ChatResultBase):
    model_config = ConfigDict(extra="allow")

    kind: str = Field(pattern=r"^[a-z][a-z0-9_]{0,31}$")

    @field_validator("kind")
    @classmethod
    def _not_a_core_kind(cls, kind: str) -> str:
        if kind in CORE_RESULT_KINDS:
            raise ValueError(f"{kind!r} results have their own shape")
        return kind

    @model_validator(mode="after")
    def _bounded(self) -> "ChatOpenResultIn":
        if len(json.dumps(self.model_extra or {}, default=str)) > OPEN_RESULT_MAX_BYTES:
            raise ValueError(f"a result over {OPEN_RESULT_MAX_BYTES} bytes is refused")
        return self


ChatToolResultIn = Annotated[
    Annotated[
        ChatQueryResultIn
        | ChatLibraryResultIn
        | ChatSavedVisualizationResultIn
        | ChatDashboardResultIn
        | ChatDashboardEditResultIn
        | ChatDataSourcesResultIn
        | ChatDataSourceSchemaResultIn
        | ChatKpiResultIn
        | ChatKpiListResultIn
        | ChatQueryDetailResultIn
        | ChatQueryEditResultIn
        | ChatVizTypeResultIn
        | ChatVizCheckResultIn
        | ChatSnippetCheckResultIn
        | ChatKpiCheckResultIn
        | ChatOperationCheckResultIn
        | ChatDownloadResultIn,
        Field(discriminator="kind"),
    ]
    | ChatOpenResultIn,
    Field(union_mode="left_to_right"),
]


class ChatToolResultPostIn(CamelModel):
    call_id: str = Field(min_length=1, max_length=128)
    result: ChatToolResultIn
