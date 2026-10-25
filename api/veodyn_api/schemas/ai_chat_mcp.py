from typing import Annotated, Any, Literal

from pydantic import Field

from veodyn_api.schemas.ai import CamelModel
from veodyn_api.schemas.ai_chat_context import ChatDataSourceEntryIn, ChatInstanceIn, ChatVizShapeIn
from veodyn_api.schemas.ai_chat_results import ChatDataSourceSchemaResultIn, ChatToolResultIn


class McpToolsIn(CamelModel):
    instance: ChatInstanceIn | None = None
    chat_enabled: bool


class McpToolOut(CamelModel):
    name: str
    description: str
    input_schema: dict[str, Any]


class McpToolsOut(CamelModel):
    tools: list[McpToolOut]


class McpCallContextIn(CamelModel):
    instance: ChatInstanceIn | None = None
    data_sources: list[ChatDataSourceEntryIn] | None = Field(default=None, max_length=100)
    schemas: list[ChatDataSourceSchemaResultIn] | None = Field(default=None, max_length=20)
    viz_catalog: list[ChatVizShapeIn] | None = Field(default=None, max_length=60)


class McpCallIn(CamelModel):
    name: str = Field(min_length=1, max_length=128)
    arguments: dict[str, Any] = Field(default_factory=dict)
    context: McpCallContextIn = Field(default_factory=McpCallContextIn)


class McpDraftOut(CamelModel):
    draft_id: str
    version: int
    thread_id: str
    url: str


class McpDoneOut(CamelModel):
    kind: Literal["done"] = "done"
    content: str
    is_error: bool
    draft: McpDraftOut | None = None


class McpClientCallOut(CamelModel):
    kind: Literal["client_call"] = "client_call"
    call_id: str
    tool: str
    args: dict[str, Any]


McpCallOut = Annotated[McpDoneOut | McpClientCallOut, Field(discriminator="kind")]


class McpResultIn(CamelModel):
    result: ChatToolResultIn
