from typing import Annotated, Literal

from pydantic import ConfigDict, Field

from veodyn_api.schemas.ai import CamelModel

MAX_MESSAGE_CHARS = 4_000

ParamScalar = str | int | float
Edition = Literal["CE", "EE", "HUB"]
COMMUNITY: Edition = "CE"


class ChatVizShapeIn(CamelModel):
    id: str = Field(max_length=64)
    type: str = Field(max_length=64)
    label: str = Field(max_length=80)
    guide: str | None = Field(default=None, max_length=400)


class ChatMapProviderIn(CamelModel):
    id: str = Field(max_length=32)
    label: str = Field(max_length=60)


class ChatInstanceIn(CamelModel):
    name: str = Field(max_length=120)
    edition: Edition
    features: list[Annotated[str, Field(max_length=64)]] = Field(default_factory=list, max_length=40)
    plugins: list[Annotated[str, Field(max_length=80)]] = Field(default_factory=list, max_length=40)
    maps: list[ChatMapProviderIn] = Field(default_factory=list, max_length=8)


class ChatDataSourceEntryIn(CamelModel):
    id: int = Field(gt=0)
    name: str = Field(max_length=255)
    type: str = Field(max_length=64)
    syntax: str = Field(max_length=16)
    view_only: bool
    no_schema: bool = False
    resources: list[Annotated[str, Field(max_length=128)]] | None = Field(default=None, max_length=60)


class ChatReadyParamIn(CamelModel):
    name: str = Field(max_length=64)
    type: str = Field(max_length=32)
    default: ParamScalar | None = None
    values: list[ParamScalar] = Field(default_factory=list, max_length=50)
    values_truncated: bool = False
    backing_query_id: int | None = Field(default=None, gt=0)


class ChatReadyQueryIn(CamelModel):
    choice_id: str = Field(max_length=64)
    query_id: int = Field(gt=0)
    name: str = Field(max_length=255)
    data_source_id: int = Field(gt=0)
    visualization_id: int = Field(gt=0)
    params: list[ChatReadyParamIn] = Field(default_factory=list, max_length=10)
    more: bool = False


SubjectKind = Literal["query", "visualization", "dashboard", "widget", "dataset", "new"]


class ChatSubjectDetailIn(CamelModel):
    model_config = ConfigDict(extra="forbid")

    kind: SubjectKind
    id: str = Field(max_length=64)
    name: str = Field(max_length=500)
    can_edit: bool | None = None
    lines: list[Annotated[str, Field(max_length=500)]] = Field(default_factory=list, max_length=40)


class ChatTurnIn(CamelModel):
    text: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)
    viz_catalog: list[ChatVizShapeIn] | None = Field(default=None, max_length=60)
    instance: ChatInstanceIn | None = None
    data_sources: list[ChatDataSourceEntryIn] | None = Field(default=None, max_length=100)
    ready_queries: list[ChatReadyQueryIn] | None = Field(default=None, max_length=20)
    subject_detail: ChatSubjectDetailIn | None = None
