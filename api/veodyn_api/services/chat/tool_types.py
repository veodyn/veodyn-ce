from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from veodyn_api.schemas.ai_chat_context import Edition
from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.services.ai_text import picked_id
from veodyn_api.services.ai_viz_catalog import DEFAULT_CATALOG, VizCatalog


@dataclass(frozen=True)
class ClientCall:
    call_id: str
    tool: str
    args: dict[str, Any]


@dataclass(frozen=True)
class Immediate:
    content: str
    is_error: bool
    draft: dict[str, Any] | None = None
    frame: tuple[str, dict[str, Any]] | None = None


SaveDraft = Callable[[str, str | None, dict[str, Any]], Awaitable[tuple[str, int]]]


@dataclass(frozen=True)
class DataSourceInfo:
    syntax: str
    view_only: bool | None = None
    resources: dict[str, tuple[str, ...]] | None = None


@dataclass
class ToolContext:
    datasets: tuple[DatasetOut, ...]
    data_source_id: Callable[[], Awaitable[int]]
    data_source_info: Callable[[int], DataSourceInfo | None]
    save_draft: SaveDraft
    query_draft_exists: Callable[[str], Awaitable[bool]]
    catalog: VizCatalog = DEFAULT_CATALOG
    refusals: int = field(default=0)
    help_links: int = field(default=0)
    library_searches: int = field(default=0)
    edition: Edition | None = None
    features: tuple[str, ...] | None = None


Handler = Callable[[str, dict[str, Any], ToolContext], Awaitable[ClientCall | Immediate]]
Completer = Callable[[ClientCall, dict[str, Any], ToolContext], Awaitable[Immediate]]


@dataclass(frozen=True)
class ChatTool:
    name: str
    definition: dict[str, Any]
    handler: Handler
    result_kind: str | None = None
    complete: Completer | None = None
    mcp_drop: tuple[str, ...] = ()
    chat_only: bool = False
    proposal: bool = False
    mcp_runnable: bool = False
    requires_pack: bool = False
    requires_feature: str | None = None


def positive_id(value: Any) -> int | None:
    number = picked_id(value)
    return number if number is not None and number > 0 else None


def schema_string(description: str) -> dict[str, str]:
    return {"type": "string", "description": description}


def schema_integer(description: str) -> dict[str, str]:
    return {"type": "integer", "description": description}
