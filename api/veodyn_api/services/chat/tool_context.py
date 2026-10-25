import json
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from veodyn_api.errors import ApiError
from veodyn_api.schemas.ai_chat_context import ChatDataSourceEntryIn, Edition
from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.services.ai_viz_catalog import VizCatalog
from veodyn_api.services.chat import store
from veodyn_api.services.chat.data_source_facts import resolve_source_info
from veodyn_api.services.chat.tools import (
    ClientCall,
    DataSourceInfo,
    Immediate,
    ToolContext,
    completer_for,
)

DbCall = Callable[..., Awaitable[Any]]
DatasetLoader = Callable[[], Awaitable[tuple[DatasetOut, ...]]]
DataSourceLoader = Callable[[], Awaitable[int]]
DraftScope = tuple[uuid.UUID, uuid.UUID]
OpenScope = Callable[[dict[str, Any]], Awaitable[DraftScope]]


def parse_uuid(value: str | None) -> uuid.UUID | None:
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


async def warehouse_visible(
    data_source_id: DataSourceLoader, sources: tuple[ChatDataSourceEntryIn, ...] | None
) -> bool:
    if sources is None:
        return False
    try:
        warehouse = await data_source_id()
    except ApiError:
        return False
    return warehouse in {source.id for source in sources}


async def visible_datasets(
    datasets: DatasetLoader, data_source_id: DataSourceLoader, sources: tuple[ChatDataSourceEntryIn, ...] | None
) -> tuple[DatasetOut, ...]:
    return await datasets() if await warehouse_visible(data_source_id, sources) else ()


def fixed_scope(thread_id: uuid.UUID, turn_id: uuid.UUID) -> OpenScope:
    async def open_scope(payload: dict[str, Any]) -> DraftScope:
        return thread_id, turn_id

    return open_scope


class DraftHooks:
    def __init__(self, db: DbCall, open_scope: OpenScope, thread_id: uuid.UUID | None) -> None:
        self._db = db
        self._open_scope = open_scope
        self._thread_id = thread_id

    async def save(self, kind: str, draft_id: str | None, payload: dict[str, Any]) -> tuple[str, int]:
        thread_id, turn_id = await self._open_scope(payload)
        saved, version = await self._db(store.save_draft, thread_id, turn_id, parse_uuid(draft_id), kind, payload)
        return str(saved), int(version)

    async def query_exists(self, draft_id: str) -> bool:
        parsed = parse_uuid(draft_id)
        if parsed is None or self._thread_id is None:
            return False
        return bool(await self._db(store.query_draft_exists, self._thread_id, parsed))


def build_tool_context(
    *,
    datasets: tuple[DatasetOut, ...],
    data_source_id: DataSourceLoader,
    sources: tuple[ChatDataSourceEntryIn, ...] | None,
    transcript: list[dict[str, Any]],
    hooks: DraftHooks,
    catalog: VizCatalog,
    edition: Edition | None,
    features: tuple[str, ...] | None = None,
) -> ToolContext:
    def data_source_info(source_id: int) -> DataSourceInfo | None:
        return resolve_source_info(source_id, sources, transcript)

    return ToolContext(
        datasets=datasets,
        data_source_id=data_source_id,
        data_source_info=data_source_info,
        save_draft=hooks.save,
        query_draft_exists=hooks.query_exists,
        catalog=catalog,
        edition=edition,
        features=features,
    )


def tool_result_block(call_id: str, content: str, is_error: bool) -> dict[str, Any]:
    block: dict[str, Any] = {"type": "tool_result", "tool_use_id": call_id, "content": content}
    if is_error:
        block["is_error"] = True
    return block


async def complete_result(request: ClientCall, result: dict[str, Any], ctx: ToolContext) -> Immediate | None:
    completer = completer_for(request.tool)
    if result.get("ok") is not True or completer is None:
        return None
    return await completer(request, result, ctx)


def settled_content(result: dict[str, Any], completed: Immediate | None) -> tuple[str, bool]:
    if completed is not None:
        return completed.content, completed.is_error
    return json.dumps(result, separators=(",", ":")), result.get("ok") is not True
