import json
import logging
from typing import Any

from veodyn_api.schemas.ai_chat_context import ChatDataSourceEntryIn
from veodyn_api.services.chat.tools import DataSourceInfo

logger = logging.getLogger(__name__)


def _tool_results_in(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for message in blocks:
        if message.get("role") != "user":
            continue
        for item in message.get("content") or []:
            if not isinstance(item, dict) or item.get("type") != "tool_result":
                continue
            try:
                parsed = json.loads(item.get("content") or "")
            except (TypeError, ValueError):
                logger.debug("a stored tool result was not JSON and was skipped")
                continue
            if isinstance(parsed, dict):
                found.append(parsed)
    return found


def _described_resources(result: dict[str, Any]) -> dict[str, tuple[str, ...]] | None:
    if not result.get("ok") or not isinstance(result.get("resources"), list):
        return None
    return {
        str(entry["name"]): tuple(str(one) for one in entry.get("params") or [])
        for entry in result["resources"]
        if isinstance(entry, dict) and entry.get("name")
    }


def resolve_source_info(
    source_id: int,
    inventory: tuple[ChatDataSourceEntryIn, ...] | None,
    transcript: list[dict[str, Any]],
) -> DataSourceInfo | None:
    syntax = ""
    view_only: bool | None = None
    for entry in inventory or ():
        if entry.id == source_id:
            syntax = entry.syntax
            view_only = entry.view_only
    resources: dict[str, tuple[str, ...]] | None = None
    refreshed = False
    present = False
    for result in _tool_results_in(transcript):
        kind = result.get("kind")
        if kind == "data_sources" and result.get("ok") is True:
            refreshed = True
            present = False
            for source in result.get("sources") or []:
                if isinstance(source, dict) and source.get("id") == source_id:
                    present = True
                    syntax = str(source.get("syntax") or syntax)
                    view_only = bool(source.get("viewOnly"))
        elif kind == "data_source_schema" and result.get("dataSourceId") == source_id:
            syntax = str(result.get("syntax") or syntax)
            described = _described_resources(result)
            if described is not None:
                resources = described
    if refreshed and not present:
        return None
    if not syntax:
        return None
    return DataSourceInfo(syntax=syntax, view_only=view_only, resources=resources)
