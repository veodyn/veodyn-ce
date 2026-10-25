from collections.abc import Callable
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from veodyn_api.auth_ai import SubjectDep
from veodyn_api.db import get_db
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.routers.ai import require_relay_key
from veodyn_api.routers.ai_chat import BusDep, LoadersDep, _redis
from veodyn_api.schemas.ai_chat_mcp import (
    McpCallIn,
    McpCallOut,
    McpDoneOut,
    McpResultIn,
    McpToolOut,
    McpToolsIn,
    McpToolsOut,
)
from veodyn_api.services.chat.mcp_calls import McpEnvironment, finish_call, start_call
from veodyn_api.services.chat.mcp_tools import mcp_tool_definitions
from veodyn_api.services.chat.tools import result_kind_for

router = APIRouter(prefix="/ai/chat/mcp", tags=["ai-chat-mcp"], dependencies=[Depends(require_relay_key)])

DbDep = Annotated[Session, Depends(get_db)]


def _environment(subject: str, db: Session, bus: BusDep, loaders: LoadersDep) -> McpEnvironment:
    async def db_call(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        return await run_in_threadpool(fn, db, *args, **kwargs)

    datasets, data_source_id = loaders
    return McpEnvironment(db=db_call, owner=subject, bus=bus, datasets=datasets, data_source_id=data_source_id)


@router.post("/tools", response_model=McpToolsOut)
async def list_tools(payload: McpToolsIn, subject: SubjectDep) -> McpToolsOut:
    definitions = mcp_tool_definitions(chat_enabled=payload.chat_enabled, instance=payload.instance)
    return McpToolsOut(tools=[McpToolOut.model_validate(one, by_alias=True) for one in definitions])


@router.post("/calls", response_model=McpCallOut)
async def post_call(
    payload: McpCallIn, subject: SubjectDep, db: DbDep, bus: BusDep, loaders: LoadersDep
) -> McpCallOut:
    environment = _environment(subject, db, bus, loaders)
    return await _redis(start_call(environment, bus, payload.name, payload.arguments, payload.context))


@router.post("/calls/{call_id}/result", response_model=McpDoneOut)
async def post_result(
    call_id: str, payload: McpResultIn, subject: SubjectDep, db: DbDep, bus: BusDep, loaders: LoadersDep
) -> McpDoneOut:
    stored = await _redis(bus.get_mcp_call(call_id))
    result = payload.result.model_dump(by_alias=True, exclude_none=True, mode="json")
    if (
        stored is None
        or stored.get("subject") != subject
        or result.get("kind") != result_kind_for(str(stored.get("tool")))
        or not await _redis(bus.spend_mcp_call(call_id))
    ):
        raise ApiError(ErrorId.AI_TOOL_RESULT_REJECTED, "no pending call is waiting for that result", 409)
    return await _redis(finish_call(_environment(subject, db, bus, loaders), call_id, stored, result))
