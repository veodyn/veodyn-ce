from dataclasses import dataclass

from veodyn_api.schemas.ai_chat_context import (
    COMMUNITY,
    ChatDataSourceEntryIn,
    ChatInstanceIn,
    ChatReadyParamIn,
    ChatReadyQueryIn,
    ChatTurnIn,
)

MAP_QUESTION_RULE = (
    "- When a result could be drawn on more than one of this instance's map providers and the analyst has not "
    "said which in this conversation, ask one question naming the providers (which map do they want), then use "
    "the answer for the rest of the conversation."
)


@dataclass(frozen=True)
class TurnContext:
    instance: ChatInstanceIn | None
    data_sources: tuple[ChatDataSourceEntryIn, ...] | None
    ready_queries: tuple[ChatReadyQueryIn, ...]


EMPTY_CONTEXT = TurnContext(instance=None, data_sources=None, ready_queries=())


def context_from(payload: ChatTurnIn) -> TurnContext:
    return TurnContext(
        instance=payload.instance,
        data_sources=tuple(payload.data_sources) if payload.data_sources is not None else None,
        ready_queries=tuple(payload.ready_queries or ()),
    )


def has_several_maps(context: TurnContext) -> bool:
    return context.instance is not None and len(context.instance.maps) > 1


def instance_block(context: TurnContext) -> str | None:
    instance = context.instance
    if instance is None:
        return None
    lines = [f"This instance is {instance.name}. Edition: {instance.edition}."]
    if instance.edition == COMMUNITY:
        lines.append("It is a community build: do not offer or describe features outside the list below.")
    lines.append(f"Enabled features: {', '.join(instance.features) or 'none'}.")
    if instance.plugins:
        lines.append(f"Visualization plugins: {', '.join(instance.plugins)}.")
    if instance.maps:
        maps = ", ".join(f"{one.label} ({one.id})" for one in instance.maps)
        lines.append(f"Map providers: {maps}.")
    return "\n".join(lines)


def _source_line(source: ChatDataSourceEntryIn) -> str:
    head = f"- {source.id} {source.name} ({source.type}, {source.syntax})"
    if source.view_only:
        return f"{head}: view-only for this analyst, ad-hoc queries cannot run on it; show saved queries instead."
    if source.no_schema:
        return (
            f"{head}: no static schema. Its tables are `query_<id>`; learn a query's columns by calling "
            "`show_visualization` on it."
        )
    if source.syntax == "json":
        if source.resources:
            return (
                f"{head}: resources {', '.join(source.resources)}. Call `describe_data_source` for a resource's "
                "params before writing a `resourceCall`."
            )
        return f"{head}: resources unknown, call `describe_data_source` to list them."
    return f"{head}: call `describe_data_source` for tables and columns."


def inventory_block(context: TurnContext) -> str | None:
    sources = context.data_sources
    if sources is None:
        return None
    if not sources:
        return "This analyst can reach no data sources besides the warehouse tables above."
    lines = [
        "Data sources this analyst can reach (ids are valid for `dataSourceId`; this list is current, so "
        "`list_data_sources` is only needed to refresh it):"
    ]
    lines.extend(_source_line(one) for one in sources)
    return "\n".join(lines)


def _param_text(param: ChatReadyParamIn) -> str:
    text = f"{param.name} ({param.type}"
    if param.default is not None:
        text += f", default {param.default}"
    text += ")"
    if param.type == "query" or param.backing_query_id is not None:
        if param.values:
            text += f" values: {', '.join(str(value) for value in param.values)}"
            if param.values_truncated:
                backing = f"query {param.backing_query_id}" if param.backing_query_id else "its backing query"
                text += f"; more values exist, call `show_visualization` on {backing} to read them all"
        else:
            text += " no stored values; node will refuse a value it cannot validate"
    return text


def _ready_line(query: ChatReadyQueryIn) -> str:
    params = "; ".join(_param_text(one) for one in query.params) or "no parameters"
    return (
        f'- {query.choice_id}: query {query.query_id} "{query.name}" on data source {query.data_source_id}, '
        f"visualization {query.visualization_id}. Parameters: {params}."
    )


def ready_queries_block(context: TurnContext) -> str | None:
    if not context.ready_queries:
        return None
    lines = [
        "Ready-made queries for visualization choices. When a question fits one, run it with `run_saved_query` "
        "(queryId, visualizationId, and params that override the defaults) instead of writing SQL:"
    ]
    lines.extend(_ready_line(one) for one in context.ready_queries)
    if any(one.more for one in context.ready_queries):
        lines.append("More ready-made queries exist than are listed; use `search_library` to find them.")
    return "\n".join(lines)
