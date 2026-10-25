import copy
from typing import Any

from veodyn_api.schemas.ai_chat_context import ChatInstanceIn
from veodyn_api.services.ai_viz_catalog import DEFAULT_CATALOG, VizCatalog
from veodyn_api.services.chat.tools import VIZ_CHOICE_FIELD, ChatTool, registered_tools, tool_definitions, tool_named

API_PACKAGE = "veodyn_api."
THREAD_ID_FIELD = "threadId"
MCP_VIZ_CHOICE = "table"
PURPOSE_FIELD = "purpose"
THREAD_ID_PROPERTY = {
    "type": "string",
    "description": (
        "The threadId from an earlier proposal's result, to put this one in the same conversation. "
        "Omit to start a new one."
    ),
}


def mcp_listed(tool: ChatTool) -> bool:
    if tool.chat_only:
        return False
    return tool.mcp_runnable or getattr(tool.handler, "__module__", "").startswith(API_PACKAGE)


def mcp_tool_named(name: str) -> ChatTool | None:
    found = tool_named(name)
    return found if found is not None and mcp_listed(found) else None


def _projected(tool: ChatTool, definition: dict[str, Any]) -> dict[str, Any]:
    schema = copy.deepcopy(definition.get("input_schema") or {})
    properties = {name: shape for name, shape in (schema.get("properties") or {}).items() if name not in tool.mcp_drop}
    if tool.proposal:
        properties[THREAD_ID_FIELD] = THREAD_ID_PROPERTY
    projected: dict[str, Any] = {"type": schema.get("type", "object"), "properties": properties}
    required = [name for name in schema.get("required") or [] if name not in tool.mcp_drop]
    if required:
        projected["required"] = required
    return {"name": tool.name, "description": definition.get("description", ""), "inputSchema": projected}


def mcp_tool_definitions(
    catalog: VizCatalog | None = None, chat_enabled: bool = True, instance: ChatInstanceIn | None = None
) -> list[dict[str, Any]]:
    edition = instance.edition if instance else None
    features = instance.features if instance else None
    shaped = {
        definition["name"]: definition
        for definition in tool_definitions(catalog or DEFAULT_CATALOG, edition, features)
    }
    return [
        _projected(tool, shaped[tool.name])
        for tool in registered_tools()
        if tool.name in shaped and mcp_listed(tool) and (chat_enabled or not tool.proposal)
    ]


def mcp_arguments(tool: ChatTool, arguments: dict[str, Any]) -> dict[str, Any]:
    prepared = {name: value for name, value in arguments.items() if name not in tool.mcp_drop}
    if VIZ_CHOICE_FIELD in tool.mcp_drop:
        prepared[VIZ_CHOICE_FIELD] = MCP_VIZ_CHOICE
    if PURPOSE_FIELD in tool.mcp_drop:
        prepared[PURPOSE_FIELD] = tool.name
    return prepared
