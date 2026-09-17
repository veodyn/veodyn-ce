import asyncio
import json
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Annotated, Any, TypeVar

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from redis.exceptions import RedisError
from sqlalchemy.orm import Session

from veodyn_api.auth import get_redash_client
from veodyn_api.auth_ai import SubjectDep
from veodyn_api.db import SessionLocal, get_db
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.models.ai_chat import AiChatDraftPromotion, AiChatThread, AiChatTurn
from veodyn_api.routers.ai import require_relay, service_key
from veodyn_api.schemas.ai_chat import (
    ChatAcceptedOut,
    ChatDraftOut,
    ChatDraftVersionOut,
    ChatPromotionIn,
    ChatPromotionOut,
    ChatThreadDetailOut,
    ChatThreadListOut,
    ChatThreadOut,
    ChatThreadPatchIn,
    ChatToolResultPostIn,
    ChatTurnIn,
    ChatTurnOut,
    ChatTurnStartedOut,
)
from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.services.ai_converse_grounding import build_grounding
from veodyn_api.services.chat import store
from veodyn_api.services.chat.bus import TurnBus, get_redis
from veodyn_api.services.chat.driver import get_chat_model
from veodyn_api.services.chat.runner import TurnRunner, spawn_turn
from veodyn_api.services.chat.tools import result_kind_for
from veodyn_api.services.redash import RedashClient
from veodyn_api.services.redash_lookups import warehouse_data_source_id
from veodyn_api.settings import Settings, get_settings

router = APIRouter(prefix="/ai/chat", tags=["ai-chat"], dependencies=[Depends(require_relay)])

PAGE_SIZE = 50
STREAM_BLOCK_MS = 5_000
TERMINAL_EVENTS = frozenset({"turn_done", "error"})
HIDDEN_BLOCKS = frozenset({"thinking", "redacted_thinking"})

T = TypeVar("T")
DbDep = Annotated[Session, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
RedashDep = Annotated[RedashClient, Depends(get_redash_client)]


def _unavailable() -> ApiError:
    return ApiError(ErrorId.AI_CHAT_UNAVAILABLE, "chat storage is unavailable", status_code=503)


async def _redis(call: Awaitable[T]) -> T:
    try:
        return await call
    except (RedisError, OSError) as exc:
        raise _unavailable() from exc


def get_turn_bus() -> TurnBus:
    return TurnBus(get_redis())


BusDep = Annotated[TurnBus, Depends(get_turn_bus)]


def get_turn_runner(settings: SettingsDep, redash: RedashDep, bus: BusDep) -> TurnRunner:
    model = get_chat_model()
    warehouse: list[int] = []

    async def datasets() -> tuple[DatasetOut, ...]:
        grounding = await asyncio.to_thread(
            build_grounding,
            "query",
            redash=redash,
            api_key=settings.redash_service_api_key or "",
            settings=settings,
        )
        return grounding.datasets

    async def data_source_id() -> int:
        if not warehouse:
            key = service_key(settings)
            warehouse.append(await asyncio.to_thread(warehouse_data_source_id, redash, api_key=key))
        return warehouse[0]

    return TurnRunner(model=model, bus=bus, sessions=SessionLocal, datasets=datasets, data_source_id=data_source_id)


RunnerDep = Annotated[TurnRunner, Depends(get_turn_runner)]
Sessions = Callable[[], Session]


def get_sessions() -> Sessions:
    return SessionLocal


SessionsDep = Annotated[Sessions, Depends(get_sessions)]


def _thread_out(thread: AiChatThread) -> ChatThreadOut:
    return ChatThreadOut(
        id=str(thread.id),
        title=thread.title,
        pinned=thread.pinned,
        created_at=thread.created_at,
        updated_at=thread.updated_at,
        last_turn_at=thread.last_turn_at,
    )


def _visible(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    visible: list[dict[str, Any]] = []
    for message in blocks:
        content = message.get("content")
        if isinstance(content, list):
            content = [
                block for block in content if not (isinstance(block, dict) and block.get("type") in HIDDEN_BLOCKS)
            ]
        visible.append({"role": message.get("role"), "content": content})
    return visible


def _turn_out(turn: AiChatTurn) -> ChatTurnOut:
    return ChatTurnOut.model_validate(
        {
            "id": str(turn.id),
            "seq": turn.seq,
            "status": turn.status,
            "user_text": turn.user_text,
            "blocks": _visible(turn.blocks),
            "stop_reason": turn.stop_reason,
            "error_id": turn.error_id,
            "created_at": turn.created_at,
            "finished_at": turn.finished_at,
        }
    )


def _promotion_out(promotion: AiChatDraftPromotion) -> ChatPromotionOut:
    return ChatPromotionOut(
        id=str(promotion.id),
        target_type=promotion.target_type,
        target_id=promotion.target_id,
        promoted_version=promotion.promoted_version,
        target_version_at_promote=promotion.target_version_at_promote,
        created_at=promotion.created_at,
    )


async def _settle_lost(bus: TurnBus, sessions: Sessions, turn_id: uuid.UUID) -> None:
    def fail() -> bool:
        with sessions() as session:
            return store.fail_turn(session, turn_id, ErrorId.AI_TURN_LOST.value)

    if await run_in_threadpool(fail):
        await _redis(
            bus.emit(str(turn_id), "error", {"id": ErrorId.AI_TURN_LOST.value, "message": "The turn was interrupted."})
        )
        await _redis(bus.seal(str(turn_id)))


@router.get("/threads", response_model=ChatThreadListOut)
async def list_threads(subject: SubjectDep, db: DbDep, offset: Annotated[int, Query(ge=0)] = 0) -> ChatThreadListOut:
    threads = await run_in_threadpool(store.list_threads, db, subject, offset=offset, limit=PAGE_SIZE + 1)
    return ChatThreadListOut(
        threads=[_thread_out(one) for one in threads[:PAGE_SIZE]],
        next_offset=offset + PAGE_SIZE if len(threads) > PAGE_SIZE else None,
    )


@router.post("/threads", response_model=ChatThreadOut, status_code=201)
async def create_thread(subject: SubjectDep, db: DbDep) -> ChatThreadOut:
    return _thread_out(await run_in_threadpool(store.create_thread, db, subject))


@router.get("/threads/{thread_id}", response_model=ChatThreadDetailOut)
async def get_thread(
    thread_id: uuid.UUID, subject: SubjectDep, db: DbDep, bus: BusDep, sessions: SessionsDep
) -> ChatThreadDetailOut:
    thread = await run_in_threadpool(store.thread_for_owner, db, subject, thread_id)
    running = await run_in_threadpool(store.running_turn, db, thread.id)
    if running is not None and not await _redis(bus.lease_alive(str(running.id))):
        await _settle_lost(bus, sessions, running.id)
        db.expire_all()
    detail = await run_in_threadpool(store.thread_detail, db, subject, thread_id)
    return ChatThreadDetailOut(
        thread=_thread_out(detail["thread"]),
        turns=[_turn_out(one) for one in detail["turns"]],
        drafts=[
            ChatDraftOut(
                id=str(entry["draft"].id),
                kind=entry["draft"].kind,
                versions=[
                    ChatDraftVersionOut(
                        version=one.version, turn_id=str(one.turn_id), payload=one.payload, created_at=one.created_at
                    )
                    for one in entry["versions"]
                ],
                promotions=[_promotion_out(one) for one in entry["promotions"]],
            )
            for entry in detail["drafts"]
        ],
    )


@router.patch("/threads/{thread_id}", response_model=ChatThreadOut)
async def patch_thread(
    thread_id: uuid.UUID, payload: ChatThreadPatchIn, subject: SubjectDep, db: DbDep
) -> ChatThreadOut:
    thread = await run_in_threadpool(
        store.update_thread, db, subject, thread_id, title=payload.title, pinned=payload.pinned
    )
    return _thread_out(thread)


@router.delete("/threads/{thread_id}", status_code=204)
async def delete_thread(thread_id: uuid.UUID, subject: SubjectDep, db: DbDep) -> Response:
    await run_in_threadpool(store.delete_thread, db, subject, thread_id)
    return Response(status_code=204)


@router.post("/threads/{thread_id}/turns", response_model=ChatTurnStartedOut, status_code=202)
async def post_turn(
    thread_id: uuid.UUID,
    payload: ChatTurnIn,
    subject: SubjectDep,
    db: DbDep,
    bus: BusDep,
    runner: RunnerDep,
    sessions: SessionsDep,
) -> ChatTurnStartedOut:
    thread = await run_in_threadpool(store.thread_for_owner, db, subject, thread_id)
    running = await run_in_threadpool(store.running_turn, db, thread.id)
    if running is not None:
        if await _redis(bus.lease_alive(str(running.id))):
            raise ApiError(ErrorId.AI_TURN_CONFLICT, "a turn is already running in this conversation", 409)
        await _settle_lost(bus, sessions, running.id)
        db.expire_all()
    turn = await run_in_threadpool(store.start_turn, db, thread, payload.text)
    try:
        await bus.hold_lease(str(turn.id))
    except (RedisError, OSError) as exc:
        await run_in_threadpool(store.fail_turn, db, turn.id, ErrorId.AI_CHAT_UNAVAILABLE.value)
        raise _unavailable() from exc
    spawn_turn(runner, turn.id, thread.id, turn.seq, payload.text)
    return ChatTurnStartedOut(turn_id=str(turn.id), seq=turn.seq)


def _sse(frame_id: str | None, event: str, data: dict[str, Any]) -> str:
    head = f"id: {frame_id}\n" if frame_id else ""
    return f"{head}event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


def _finished_frame(sessions: Sessions, turn_id: uuid.UUID) -> tuple[str, dict[str, Any]] | None:
    with sessions() as session:
        turn = session.get(AiChatTurn, turn_id)
        if turn is None or turn.status == "running":
            return None
        if turn.status == "failed":
            return "error", {"id": turn.error_id or ErrorId.INTERNAL_ERROR.value, "message": "The turn failed."}
        return "turn_done", {"stopReason": turn.stop_reason or "end_turn", "usage": turn.usage or {}}


@router.get(
    "/turns/{turn_id}/stream",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}, "description": "The turn's frames as server-sent events"}},
)
async def stream_turn(
    turn_id: uuid.UUID,
    request: Request,
    subject: SubjectDep,
    db: DbDep,
    bus: BusDep,
    sessions: SessionsDep,
    last_event_id: Annotated[str | None, Header()] = None,
) -> StreamingResponse:
    await run_in_threadpool(store.turn_for_owner, db, subject, turn_id)
    key = str(turn_id)

    async def frames() -> AsyncIterator[str]:
        after = last_event_id
        while not await request.is_disconnected():
            try:
                batch = await bus.read(key, after, block_ms=STREAM_BLOCK_MS)
                alive = bool(batch) or await bus.lease_alive(key)
            except (RedisError, OSError):
                yield _sse(None, "error", {"id": ErrorId.AI_CHAT_UNAVAILABLE.value, "message": "Chat is unavailable."})
                return
            for frame_id, event, data in batch:
                after = frame_id
                yield _sse(frame_id, event, data)
                if event in TERMINAL_EVENTS:
                    return
            if alive:
                if not batch:
                    yield ": keep-alive\n\n"
                continue
            await _settle_lost(bus, sessions, turn_id)
            finished = await run_in_threadpool(_finished_frame, sessions, turn_id)
            if finished is not None and not await bus.read(key, after, block_ms=1):
                yield _sse(None, finished[0], finished[1])
                return

    return StreamingResponse(
        frames(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/turns/{turn_id}/tool-results", response_model=ChatAcceptedOut, status_code=202)
async def post_tool_result(
    turn_id: uuid.UUID, payload: ChatToolResultPostIn, subject: SubjectDep, db: DbDep, bus: BusDep
) -> ChatAcceptedOut:
    turn = await run_in_threadpool(store.turn_for_owner, db, subject, turn_id)
    pending = await _redis(bus.pending(str(turn.id)))
    expected = result_kind_for(pending.tool) if pending else None
    if (
        turn.status != "running"
        or pending is None
        or pending.call_id != payload.call_id
        or payload.result.kind != expected
    ):
        raise ApiError(ErrorId.AI_TOOL_RESULT_REJECTED, "this turn is not waiting for that result", 409)
    result = payload.result.model_dump(by_alias=True, exclude_none=True, mode="json")
    await _redis(bus.push_result(str(turn.id), {"callId": payload.call_id, "result": result}))
    return ChatAcceptedOut(accepted=True)


@router.post("/turns/{turn_id}/cancel", response_model=ChatAcceptedOut, status_code=202)
async def cancel_turn(turn_id: uuid.UUID, subject: SubjectDep, db: DbDep, bus: BusDep) -> ChatAcceptedOut:
    turn = await run_in_threadpool(store.turn_for_owner, db, subject, turn_id)
    await _redis(bus.request_cancel(str(turn.id)))
    return ChatAcceptedOut(accepted=True)


@router.post("/drafts/{draft_id}/promotions", response_model=ChatPromotionOut, status_code=201)
async def post_promotion(
    draft_id: uuid.UUID, payload: ChatPromotionIn, subject: SubjectDep, db: DbDep
) -> ChatPromotionOut:
    draft = await run_in_threadpool(store.draft_for_owner, db, subject, draft_id)
    promotion = await run_in_threadpool(
        store.record_promotion,
        db,
        draft,
        version=payload.version,
        target_type=payload.target_type,
        target_id=payload.target_id,
        target_version_at_promote=payload.target_version_at_promote,
    )
    return _promotion_out(promotion)
