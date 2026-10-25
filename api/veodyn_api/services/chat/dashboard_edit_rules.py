from typing import Any

from pydantic import ValidationError

from veodyn_api.schemas.ai_chat_dashboard import (
    GRID_COLUMNS,
    MAX_MAPPINGS,
    MAX_ROW_SPAN,
    MAX_TEXT_CHARS,
    ParameterMappingIn,
    PlacedPositionIn,
)
from veodyn_api.services.chat.tools import Immediate, ToolContext, positive_id

MAX_NAME_CHARS = 200
MAX_TAGS = 10
MAX_TAG_CHARS = 64
MAX_DRAFT_ID_CHARS = 64
MAPPING_TYPES = ("dashboard-add-new", "dashboard-map-to-existing", "widget-level", "static-value")
POSITION_KEYS = ("col", "row", "sizeX", "sizeY")
OPERATION_KEYS: dict[str, frozenset[str]] = {
    "add": frozenset({"op", "queryId", "visualizationId", "queryDraftId", "position", "parameterMappings"}),
    "addText": frozenset({"op", "text", "position"}),
    "editText": frozenset({"op", "widgetId", "text"}),
    "remove": frozenset({"op", "widgetId"}),
    "move": frozenset({"op", "widgetId", "position"}),
}


def refused(message: str) -> Immediate:
    return Immediate(message, is_error=True)


def _text(value: Any, field: str) -> str | Immediate:
    text = value.strip() if isinstance(value, str) else ""
    if not text or len(text) > MAX_TEXT_CHARS:
        return refused(f"{field} must be markdown of 1 to {MAX_TEXT_CHARS} characters")
    return text


def _position(value: Any, label: str) -> dict[str, int] | Immediate:
    grid = (
        f"{label} position must be whole numbers: col 0 to {GRID_COLUMNS - 1}, row 0 or more, sizeX 1 to "
        f"{GRID_COLUMNS} with col + sizeX at most {GRID_COLUMNS}, sizeY 1 to {MAX_ROW_SPAN}"
    )
    if not isinstance(value, dict) or set(value) != set(POSITION_KEYS):
        return refused(grid)
    try:
        parsed = PlacedPositionIn.model_validate(value, strict=True)
    except ValidationError:
        return refused(grid)
    return parsed.model_dump(by_alias=True)


def _mappings(value: Any, label: str) -> dict[str, Any] | Immediate:
    problem = refused(
        f"{label} parameterMappings must map each query parameter name to an object with a type "
        f"({', '.join(MAPPING_TYPES)}), plus mapTo or value"
    )
    if not isinstance(value, dict) or not value or len(value) > MAX_MAPPINGS:
        return problem
    mappings: dict[str, Any] = {}
    for name, raw in value.items():
        if not isinstance(name, str) or not name.strip() or not isinstance(raw, dict):
            return problem
        try:
            parsed = ParameterMappingIn.model_validate(raw, strict=True)
        except ValidationError:
            return problem
        mappings[name] = parsed.model_dump(by_alias=True, exclude_unset=True)
    return mappings


async def _add(raw: dict[str, Any], label: str, ctx: ToolContext) -> dict[str, Any] | Immediate:
    operation: dict[str, Any] = {"op": "add"}
    draft_id = raw.get("queryDraftId")
    if draft_id is not None:
        if raw.get("queryId") is not None or raw.get("visualizationId") is not None:
            return refused(f"{label} names a queryDraftId or a queryId with a visualizationId, not both")
        if not isinstance(draft_id, str) or not draft_id.strip() or len(draft_id) > MAX_DRAFT_ID_CHARS:
            return refused(f"{label} queryDraftId must be a query you proposed earlier in this conversation")
        if not await ctx.query_draft_exists(draft_id):
            return refused(
                f"{label} queryDraftId must be a query you proposed earlier in this conversation, "
                "with at least one version"
            )
        operation["queryDraftId"] = draft_id
    else:
        query_id = positive_id(raw.get("queryId"))
        visualization_id = positive_id(raw.get("visualizationId"))
        if query_id is None:
            return refused(f"{label} needs a queryId from a search result, or a queryDraftId")
        if visualization_id is None:
            return refused(f"{label} needs the visualizationId of one of that query's visualizations")
        operation.update({"queryId": query_id, "visualizationId": visualization_id})
    if raw.get("position") is not None:
        position = _position(raw["position"], label)
        if isinstance(position, Immediate):
            return position
        operation["position"] = position
    if raw.get("parameterMappings") is not None:
        mappings = _mappings(raw["parameterMappings"], label)
        if isinstance(mappings, Immediate):
            return mappings
        operation["parameterMappings"] = mappings
    return operation


async def checked_operation(raw: Any, index: int, ctx: ToolContext) -> dict[str, Any] | Immediate:
    label = f"operation {index + 1}:"
    if not isinstance(raw, dict):
        return refused(f"{label} each of operations must be an object with an op")
    kind = raw.get("op")
    if not isinstance(kind, str) or kind not in OPERATION_KEYS:
        return refused(f"{label} op must be one of {', '.join(OPERATION_KEYS)}")
    unknown = sorted(set(raw) - OPERATION_KEYS[kind])
    if unknown:
        return refused(f"{label} {kind} does not take {', '.join(unknown)}")
    if kind == "add":
        return await _add(raw, label, ctx)
    operation: dict[str, Any] = {"op": kind}
    if kind != "addText":
        widget_id = positive_id(raw.get("widgetId"))
        if widget_id is None:
            return refused(f"{label} widgetId must be a widget id from open_dashboard")
        operation["widgetId"] = widget_id
    if kind in ("addText", "editText"):
        text = _text(raw.get("text"), f"{label} text")
        if isinstance(text, Immediate):
            return text
        operation["text"] = text
    if kind == "move" or (kind == "addText" and raw.get("position") is not None):
        position = _position(raw.get("position"), label)
        if isinstance(position, Immediate):
            return position
        operation["position"] = position
    return operation


def checked_tags(value: Any) -> list[str] | Immediate:
    problem = refused(f"tags must be the full new list: at most {MAX_TAGS} tags of 1 to {MAX_TAG_CHARS} characters")
    if not isinstance(value, list) or len(value) > MAX_TAGS:
        return problem
    tags: list[str] = []
    for one in value:
        if not isinstance(one, str) or not one.strip() or len(one.strip()) > MAX_TAG_CHARS:
            return problem
        tags.append(one.strip())
    return tags
