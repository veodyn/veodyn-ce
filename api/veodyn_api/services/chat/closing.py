import copy
import json
from collections.abc import Callable
from typing import Any

from veodyn_api.services.chat.driver import ChatModel, TextSink

CLOSING_RESERVE_SECONDS = 45.0
CLOSING_BUDGET_CHARS = 120_000
CUT_KEEP_CHARS = 200
CUT_MARKER = " [older result cut to fit the context]"
NOT_FINISHED_RESULT = {"ok": False, "error": "not finished before the turn ended"}


def not_finished_block(call_id: str) -> dict[str, Any]:
    return {
        "type": "tool_result",
        "tool_use_id": call_id,
        "content": json.dumps(NOT_FINISHED_RESULT, separators=(",", ":")),
        "is_error": True,
    }


def _is_results_message(message: dict[str, Any]) -> bool:
    content = message.get("content")
    return (
        message.get("role") == "user"
        and isinstance(content, list)
        and all(isinstance(item, dict) and item.get("type") == "tool_result" for item in content)
    )


def settle_pending(blocks: list[dict[str, Any]], pending_ids: list[str]) -> None:
    if not pending_ids:
        return
    settled = [not_finished_block(call_id) for call_id in pending_ids]
    if blocks and _is_results_message(blocks[-1]):
        blocks[-1]["content"].extend(settled)
    else:
        blocks.append({"role": "user", "content": settled})


def _result_items(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        item
        for message in blocks
        if _is_results_message(message)
        for item in message["content"]
        if isinstance(item.get("content"), str)
    ]


def bounded_turn_blocks(blocks: list[dict[str, Any]], budget_chars: int) -> list[dict[str, Any]]:
    bounded = copy.deepcopy(blocks)
    items = _result_items(bounded)
    total = sum(len(item["content"]) for item in items)
    for item in items[:-1]:
        if total <= budget_chars:
            break
        body = item["content"]
        if len(body) <= CUT_KEEP_CHARS:
            continue
        item["content"] = body[:CUT_KEEP_CHARS] + CUT_MARKER
        total -= len(body) - len(item["content"])
    return bounded


async def close_turn(
    model: ChatModel,
    system: list[dict[str, Any]],
    opening: list[dict[str, Any]],
    blocks: list[dict[str, Any]],
    on_text: TextSink,
    *,
    tools: list[dict[str, Any]],
    on_usage: Callable[[dict[str, Any]], None],
) -> str:
    messages = [*opening, *bounded_turn_blocks(blocks, CLOSING_BUDGET_CHARS)]
    turn = await model.run(system=system, messages=messages, tools=tools, on_text=on_text, forbid_tools=True)
    on_usage(turn.usage)
    written = [block for block in turn.content if block.get("type") != "tool_use"]
    blocks.append({"role": "assistant", "content": written})
    return turn.stop_reason
