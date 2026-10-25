from typing import Annotated, Any, Literal

from pydantic import Field, model_validator

from veodyn_api.schemas.ai import CamelModel
from veodyn_api.schemas.ai_chat_result_base import ChatResultBase, Tag

MAX_TEXT_CHARS = 4_000
MAX_EDIT_OPERATIONS = 30
MAX_EDIT_PROBLEMS = 20
MAX_SNAPSHOT_WIDGETS = 500
MAX_MAPPINGS = 50
GRID_COLUMNS = 6
MAX_ROW_SPAN = 40

MappingType = Literal["dashboard-add-new", "dashboard-map-to-existing", "widget-level", "static-value"]


class ParameterMappingIn(CamelModel):
    type: MappingType
    map_to: str | None = Field(default=None, max_length=100)
    value: Any | None = None
    title: str | None = Field(default=None, max_length=255)


class WidgetPositionIn(CamelModel):
    col: int = Field(ge=0)
    row: int = Field(ge=0)
    size_x: int = Field(ge=0)
    size_y: int = Field(ge=0)


class PlacedPositionIn(CamelModel):
    col: int = Field(ge=0, le=GRID_COLUMNS - 1)
    row: int = Field(ge=0)
    size_x: int = Field(ge=1, le=GRID_COLUMNS)
    size_y: int = Field(ge=1, le=MAX_ROW_SPAN)

    @model_validator(mode="after")
    def _fits_the_grid(self) -> "PlacedPositionIn":
        if self.col + self.size_x > GRID_COLUMNS:
            raise ValueError(f"col + sizeX must be at most {GRID_COLUMNS}")
        return self


class ChatDashboardEditWidgetIn(CamelModel):
    widget_id: int = Field(gt=0)
    kind: Literal["visualization", "text"]
    title: str = Field(max_length=500)
    position: WidgetPositionIn
    updated_at: str | None = Field(default=None, max_length=64)


class ChatDashboardSnapshotIn(CamelModel):
    name: str = Field(max_length=500)
    tags: list[Tag] = Field(default_factory=list, max_length=10)
    version: int | None = None
    updated_at: str | None = Field(default=None, max_length=64)
    widgets: list[ChatDashboardEditWidgetIn] = Field(default_factory=list, max_length=MAX_SNAPSHOT_WIDGETS)


class ChatResolvedOperationIn(CamelModel):
    op: Literal["add", "addText", "editText", "remove", "move"]
    position: PlacedPositionIn
    query_id: int | None = Field(default=None, gt=0)
    visualization_id: int | None = Field(default=None, gt=0)
    query_draft_id: str | None = Field(default=None, min_length=1, max_length=64)
    parameter_mappings: dict[Annotated[str, Field(max_length=255)], ParameterMappingIn] | None = Field(
        default=None, max_length=MAX_MAPPINGS
    )
    widget_id: int | None = Field(default=None, gt=0)
    text: str | None = Field(default=None, min_length=1, max_length=MAX_TEXT_CHARS)
    title: str | None = Field(default=None, max_length=500)
    updated_at: str | None = Field(default=None, min_length=1, max_length=64)

    @model_validator(mode="after")
    def _has_what_the_apply_needs(self) -> "ChatResolvedOperationIn":
        if self.op == "add":
            by_id = self.query_id is not None and self.visualization_id is not None
            if by_id == (self.query_draft_id is not None) or self.title is None:
                raise ValueError("an add names a query and visualization or a query draft, and carries a title")
        elif self.op == "addText":
            if self.text is None:
                raise ValueError("an addText carries its text")
        else:
            if self.widget_id is None or self.title is None or self.updated_at is None:
                raise ValueError(f"a {self.op} carries widgetId, title and updatedAt")
            if self.op == "editText" and self.text is None:
                raise ValueError("an editText carries its text")
        return self


class ChatDashboardEditResultIn(ChatResultBase):
    kind: Literal["dashboard_edit"]
    dashboard_id: int | None = Field(default=None, gt=0)
    snapshot: ChatDashboardSnapshotIn | None = None
    name: str | None = Field(default=None, min_length=1, max_length=200)
    tags: list[Tag] | None = Field(default=None, max_length=10)
    operations: list[ChatResolvedOperationIn] = Field(default_factory=list, max_length=MAX_EDIT_OPERATIONS)
    problems: list[Annotated[str, Field(max_length=500)]] = Field(default_factory=list, max_length=MAX_EDIT_PROBLEMS)
