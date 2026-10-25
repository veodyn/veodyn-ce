from typing import Annotated, Any, Literal, Self

from pydantic import Field, model_validator

from veodyn_api.schemas.ai import CamelModel
from veodyn_api.schemas.ai_chat_result_base import ChatResultBase

MAX_OPERATION_PROBLEMS = 10
MAX_OPERATION_PARAMS = 20
MAX_EXPIRES_AT_CHARS = 40
MAX_HREF_CHARS = 300
REFRESH_SECONDS = (0, 30, 60, 300, 900)
DOWNLOAD_FORMATS = ("csv", "xlsx")
OperationName = Literal["fork", "archive", "restore", "favorite", "unfavorite", "share", "revoke"]
DESTRUCTIVE_OPERATIONS = frozenset({"archive", "revoke"})


class ChatOperationTargetIn(CamelModel):
    kind: Literal["query", "dashboard", "visualization"]
    id: int = Field(gt=0)
    name: str = Field(max_length=500)
    query_id: int | None = Field(default=None, gt=0)


class ChatOperationSnapshotIn(CamelModel):
    updated_at: str = Field(max_length=64)


class ChatOperationCheckResultIn(ChatResultBase):
    kind: Literal["operation_check"]
    op: OperationName | None = None
    target: ChatOperationTargetIn | None = None
    params: dict[str, Any] = Field(default_factory=dict, max_length=MAX_OPERATION_PARAMS)
    destructive: bool = False
    snapshot: ChatOperationSnapshotIn | None = None
    problems: list[Annotated[str, Field(max_length=500)]] = Field(
        default_factory=list, max_length=MAX_OPERATION_PROBLEMS
    )


class ChatDownloadResultIn(ChatResultBase):
    kind: Literal["download"]
    query_id: int | None = Field(default=None, gt=0)
    format: Literal["csv", "xlsx"] | None = None
    href: str | None = Field(default=None, max_length=MAX_HREF_CHARS)

    @model_validator(mode="after")
    def _a_download_points_at_the_query_result_it_names(self) -> Self:
        if not self.ok:
            return self
        if self.query_id is None or self.format is None or self.href is None:
            raise ValueError("a download needs queryId, format and href")
        if self.href != f"/api/node/queries/{self.query_id}/results.{self.format}":
            raise ValueError("href must be the result download of the query and format it names")
        return self
