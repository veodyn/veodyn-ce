from collections.abc import Sequence
from importlib import import_module
from typing import Any

from veodyn_api.schemas.ai_chat_context import COMMUNITY, Edition
from veodyn_api.services.ai_viz_catalog import DEFAULT_CATALOG, VizCatalog
from veodyn_api.services.chat.dashboard_proposal_tool import PROPOSE_DASHBOARD
from veodyn_api.services.chat.help_link_tool import LINK_HELP
from veodyn_api.services.chat.library_tools import (
    MAX_LIBRARY_SEARCHES,
    OPEN_DASHBOARD,
    SEARCH_LIBRARY,
    SHOW_VISUALIZATION,
)
from veodyn_api.services.chat.query_target import (
    CANNOT_QUERY_YET,
    MAX_NAMED_TABLES,
    SECOND_REFUSAL,
    checked_body,
    resolve_target,
)
from veodyn_api.services.chat.query_tools import DESCRIBE_DATA_SOURCE, LIST_DATA_SOURCES, PROPOSE_QUERY, RUN_QUERY
from veodyn_api.services.chat.tool_types import (
    ChatTool,
    ClientCall,
    Completer,
    DataSourceInfo,
    Handler,
    Immediate,
    SaveDraft,
    ToolContext,
    positive_id,
    schema_integer,
    schema_string,
)

__all__ = [
    "CANNOT_QUERY_YET",
    "DESCRIBE_DATA_SOURCE",
    "LINK_HELP",
    "LIST_DATA_SOURCES",
    "MAX_LIBRARY_SEARCHES",
    "MAX_NAMED_TABLES",
    "SECOND_REFUSAL",
    "checked_body",
    "resolve_target",
    "OPEN_DASHBOARD",
    "PROPOSE_DASHBOARD",
    "PROPOSE_QUERY",
    "RUN_QUERY",
    "SEARCH_LIBRARY",
    "SHOW_VISUALIZATION",
    "VIZ_CHOICE_FIELD",
    "ChatTool",
    "ClientCall",
    "Completer",
    "DataSourceInfo",
    "Handler",
    "Immediate",
    "SaveDraft",
    "ToolContext",
    "completer_for",
    "is_offered",
    "positive_id",
    "prepare_call",
    "register_chat_tool",
    "registered_tools",
    "result_kind_for",
    "schema_integer",
    "schema_string",
    "tool_definitions",
    "tool_named",
]


_TOOLS: dict[str, ChatTool] = {}


def registered_tools() -> tuple[ChatTool, ...]:
    return tuple(_TOOLS.values())


def tool_named(name: str) -> ChatTool | None:
    return _TOOLS.get(name)


def register_chat_tool(tool: ChatTool) -> None:
    if tool.name in _TOOLS:
        raise ValueError(f"a chat tool called {tool.name!r} is already registered")
    if tool.definition.get("name") != tool.name:
        raise ValueError(f"the definition of {tool.name!r} names a different tool")
    _TOOLS[tool.name] = tool


def result_kind_for(tool: str) -> str | None:
    found = _TOOLS.get(tool)
    return found.result_kind if found else None


def completer_for(tool: str) -> Completer | None:
    found = _TOOLS.get(tool)
    return found.complete if found else None


VIZ_CHOICE_FIELD = "vizChoiceId"


def _with_shapes(definition: dict[str, Any], catalog: VizCatalog) -> dict[str, Any]:
    schema = definition.get("input_schema")
    if not isinstance(schema, dict):
        return dict(definition)
    properties = schema.get("properties")
    if not isinstance(properties, dict) or VIZ_CHOICE_FIELD not in properties:
        return dict(definition)
    shape_field = {"type": "string", "enum": list(catalog.ids), "description": catalog.field_description}
    return {
        **definition,
        "input_schema": {**schema, "properties": {**properties, VIZ_CHOICE_FIELD: shape_field}},
    }


def is_offered(tool: ChatTool, edition: Edition | None, features: Sequence[str] | None) -> bool:
    if tool.requires_pack and (edition is None or edition == COMMUNITY):
        return False
    return tool.requires_feature is None or (features is not None and tool.requires_feature in features)


def tool_definitions(
    catalog: VizCatalog | None = None, edition: Edition | None = None, features: Sequence[str] | None = None
) -> list[dict[str, Any]]:
    return [
        _with_shapes(tool.definition, catalog or DEFAULT_CATALOG)
        for tool in _TOOLS.values()
        if is_offered(tool, edition, features)
    ]


async def prepare_call(block: dict[str, Any], ctx: ToolContext) -> ClientCall | Immediate:
    name = str(block.get("name") or "")
    tool = _TOOLS.get(name)
    if tool is None or not is_offered(tool, ctx.edition, ctx.features):
        return Immediate(f"there is no tool called {name!r}", is_error=True)
    arguments = block.get("input")
    return await tool.handler(str(block.get("id") or ""), arguments if isinstance(arguments, dict) else {}, ctx)


for _tool in (
    RUN_QUERY,
    PROPOSE_QUERY,
    LIST_DATA_SOURCES,
    DESCRIBE_DATA_SOURCE,
    SEARCH_LIBRARY,
    SHOW_VISUALIZATION,
    OPEN_DASHBOARD,
    PROPOSE_DASHBOARD,
    LINK_HELP,
):
    register_chat_tool(_tool)


import_module("veodyn_api.services.chat.saved_query_tool")

import_module("veodyn_api.services.chat.query_edit_tool")
import_module("veodyn_api.services.chat.viz_tools")
import_module("veodyn_api.services.chat.dashboard_edit_tool")
import_module("veodyn_api.services.chat.snippet_tools")
import_module("veodyn_api.services.chat.kpi_tool")
import_module("veodyn_api.services.chat.report_message_tools")
import_module("veodyn_api.services.chat.operation_tools")
