import json
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.models.ai_chat import (
    AiChatDraft,
    AiChatDraftPromotion,
    AiChatDraftVersion,
    AiChatThread,
    AiChatTurn,
)

MAX_TURNS_PER_THREAD = 200
TITLE_CHARS = 80
REPLAY_DROPPED_BLOCKS = frozenset({"thinking", "redacted_thinking"})


def _now() -> datetime:
    return datetime.now(UTC)


def _missing() -> ApiError:
    return ApiError(ErrorId.AI_CHAT_NOT_FOUND, "no such conversation", status_code=404)


def create_thread(db: Session, owner: str) -> AiChatThread:
    thread = AiChatThread(id=uuid.uuid4(), owner_subject=owner, title="", pinned=False)
    db.add(thread)
    db.commit()
    db.refresh(thread)
    return thread


def list_threads(db: Session, owner: str, *, offset: int, limit: int) -> list[AiChatThread]:
    statement = (
        select(AiChatThread)
        .where(AiChatThread.owner_subject == owner)
        .order_by(AiChatThread.pinned.desc(), AiChatThread.last_turn_at.desc(), AiChatThread.id)
        .offset(offset)
        .limit(limit)
    )
    return list(db.scalars(statement))


def thread_for_owner(db: Session, owner: str, thread_id: uuid.UUID) -> AiChatThread:
    thread = db.scalar(select(AiChatThread).where(AiChatThread.id == thread_id, AiChatThread.owner_subject == owner))
    if thread is None:
        raise _missing()
    return thread


def update_thread(
    db: Session, owner: str, thread_id: uuid.UUID, *, title: str | None, pinned: bool | None
) -> AiChatThread:
    thread = thread_for_owner(db, owner, thread_id)
    if title is not None:
        thread.title = title.strip()[:TITLE_CHARS]
    if pinned is not None:
        thread.pinned = pinned
    thread.updated_at = _now()
    db.commit()
    db.refresh(thread)
    return thread


def delete_thread(db: Session, owner: str, thread_id: uuid.UUID) -> None:
    thread = thread_for_owner(db, owner, thread_id)
    db.delete(thread)
    db.commit()


def running_turn(db: Session, thread_id: uuid.UUID) -> AiChatTurn | None:
    return db.scalar(select(AiChatTurn).where(AiChatTurn.thread_id == thread_id, AiChatTurn.status == "running"))


def start_turn(db: Session, thread: AiChatThread, text: str) -> AiChatTurn:
    count = db.scalar(select(func.count()).select_from(AiChatTurn).where(AiChatTurn.thread_id == thread.id)) or 0
    if count >= MAX_TURNS_PER_THREAD:
        raise ApiError(
            ErrorId.AI_TURN_CONFLICT, "this conversation is full; start a new one to continue", status_code=409
        )
    last = db.scalar(select(func.max(AiChatTurn.seq)).where(AiChatTurn.thread_id == thread.id))
    turn = AiChatTurn(
        id=uuid.uuid4(),
        thread_id=thread.id,
        seq=(last or 0) + 1,
        status="running",
        user_text=text,
        blocks=[],
    )
    if not thread.title:
        thread.title = " ".join(text.split())[:TITLE_CHARS]
    thread.last_turn_at = _now()
    thread.updated_at = thread.last_turn_at
    db.add(turn)
    db.commit()
    db.refresh(turn)
    return turn


def turn_for_owner(db: Session, owner: str, turn_id: uuid.UUID) -> AiChatTurn:
    turn = db.scalar(
        select(AiChatTurn)
        .join(AiChatThread, AiChatThread.id == AiChatTurn.thread_id)
        .where(AiChatTurn.id == turn_id, AiChatThread.owner_subject == owner)
    )
    if turn is None:
        raise _missing()
    return turn


def finish_turn(
    db: Session,
    turn_id: uuid.UUID,
    *,
    status: str,
    blocks: list[dict[str, Any]],
    usage: dict[str, Any] | None,
    stop_reason: str | None,
    error_id: str | None,
) -> None:
    turn = db.get(AiChatTurn, turn_id)
    if turn is None:
        return
    turn.status = status
    turn.blocks = blocks
    turn.usage = usage
    turn.stop_reason = stop_reason
    turn.error_id = error_id
    turn.finished_at = _now()
    db.commit()


def fail_turn(db: Session, turn_id: uuid.UUID, error_id: str) -> bool:
    turn = db.get(AiChatTurn, turn_id)
    if turn is None or turn.status != "running":
        return False
    turn.status = "failed"
    turn.error_id = error_id
    turn.finished_at = _now()
    db.commit()
    return True


def _replayable(message: dict[str, Any]) -> dict[str, Any] | None:
    content = message.get("content")
    if not isinstance(content, list):
        return message
    kept = [block for block in content if not (isinstance(block, dict) and block.get("type") in REPLAY_DROPPED_BLOCKS)]
    if not kept:
        return None
    return {"role": message.get("role"), "content": kept}


def _turn_messages(turn: AiChatTurn) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = [{"role": "user", "content": [{"type": "text", "text": turn.user_text}]}]
    for message in turn.blocks:
        replayable = _replayable(message)
        if replayable is not None:
            messages.append(replayable)
    return messages


def _ends_cleanly(messages: list[dict[str, Any]]) -> bool:
    last = messages[-1]
    if last.get("role") != "assistant":
        return False
    content = last.get("content")
    return not (
        isinstance(content, list) and any(isinstance(b, dict) and b.get("type") == "tool_use" for b in content)
    )


def replay(db: Session, thread_id: uuid.UUID, before_seq: int, budget: int) -> tuple[list[dict[str, Any]], bool]:
    turns = db.scalars(
        select(AiChatTurn)
        .where(AiChatTurn.thread_id == thread_id, AiChatTurn.seq < before_seq, AiChatTurn.status == "done")
        .order_by(AiChatTurn.seq.desc())
    )
    kept: list[list[dict[str, Any]]] = []
    used = 0
    omitted = False
    for turn in turns:
        messages = _turn_messages(turn)
        if not _ends_cleanly(messages):
            continue
        size = len(json.dumps(messages))
        if used + size > budget:
            omitted = True
            break
        kept.append(messages)
        used += size
    return [message for messages in reversed(kept) for message in messages], omitted


def save_draft(
    db: Session,
    thread_id: uuid.UUID,
    turn_id: uuid.UUID,
    draft_id: uuid.UUID | None,
    kind: str,
    payload: dict[str, Any],
) -> tuple[uuid.UUID, int]:
    draft = None
    if draft_id is not None:
        draft = db.scalar(select(AiChatDraft).where(AiChatDraft.id == draft_id, AiChatDraft.thread_id == thread_id))
    if draft is None or draft.kind != kind:
        draft = AiChatDraft(id=uuid.uuid4(), thread_id=thread_id, kind=kind)
        db.add(draft)
        db.flush()
    last = db.scalar(select(func.max(AiChatDraftVersion.version)).where(AiChatDraftVersion.draft_id == draft.id))
    version = (last or 0) + 1
    db.add(AiChatDraftVersion(draft_id=draft.id, version=version, turn_id=turn_id, payload=payload))
    db.commit()
    return draft.id, version


def draft_for_owner(db: Session, owner: str, draft_id: uuid.UUID) -> AiChatDraft:
    draft = db.scalar(
        select(AiChatDraft)
        .join(AiChatThread, AiChatThread.id == AiChatDraft.thread_id)
        .where(AiChatDraft.id == draft_id, AiChatThread.owner_subject == owner)
    )
    if draft is None:
        raise _missing()
    return draft


def record_promotion(
    db: Session,
    draft: AiChatDraft,
    *,
    version: int,
    target_type: str,
    target_id: str,
    target_version_at_promote: int | None,
) -> AiChatDraftPromotion:
    exists = db.scalar(
        select(AiChatDraftVersion).where(
            AiChatDraftVersion.draft_id == draft.id, AiChatDraftVersion.version == version
        )
    )
    if exists is None:
        raise ApiError(ErrorId.INVALID_REQUEST, f"the draft has no version {version}", status_code=422)
    promotion = AiChatDraftPromotion(
        id=uuid.uuid4(),
        draft_id=draft.id,
        target_type=target_type,
        target_id=target_id,
        promoted_version=version,
        target_version_at_promote=target_version_at_promote,
    )
    db.add(promotion)
    db.commit()
    db.refresh(promotion)
    return promotion


def thread_detail(db: Session, owner: str, thread_id: uuid.UUID) -> dict[str, Any]:
    thread = thread_for_owner(db, owner, thread_id)
    turns = list(db.scalars(select(AiChatTurn).where(AiChatTurn.thread_id == thread.id).order_by(AiChatTurn.seq)))
    drafts = list(
        db.scalars(select(AiChatDraft).where(AiChatDraft.thread_id == thread.id).order_by(AiChatDraft.created_at))
    )
    draft_ids = [draft.id for draft in drafts]
    versions = list(
        db.scalars(
            select(AiChatDraftVersion)
            .where(AiChatDraftVersion.draft_id.in_(draft_ids))
            .order_by(AiChatDraftVersion.version)
        )
    )
    promotions = list(
        db.scalars(
            select(AiChatDraftPromotion)
            .where(AiChatDraftPromotion.draft_id.in_(draft_ids))
            .order_by(AiChatDraftPromotion.created_at)
        )
    )
    return {
        "thread": thread,
        "turns": turns,
        "drafts": [
            {
                "draft": draft,
                "versions": [one for one in versions if one.draft_id == draft.id],
                "promotions": [one for one in promotions if one.draft_id == draft.id],
            }
            for draft in drafts
        ],
    }
