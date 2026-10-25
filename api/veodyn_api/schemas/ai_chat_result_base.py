from typing import Annotated

from pydantic import Field

from veodyn_api.schemas.ai import CamelModel

Tag = Annotated[str, Field(max_length=64)]


class ChatResultBase(CamelModel):
    ok: bool
    error: str | None = Field(default=None, max_length=500)


class ChatVisualizationRefIn(CamelModel):
    id: int = Field(gt=0)
    name: str = Field(max_length=500)
    type: str = Field(max_length=64)
