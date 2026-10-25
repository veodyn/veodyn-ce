from dataclasses import dataclass
from typing import Any

from veodyn_api.schemas.ai_chat_context import (
    COMMUNITY,
    ChatDataSourceEntryIn,
    ChatInstanceIn,
    ChatReadyParamIn,
    ChatReadyQueryIn,
    ChatSubjectDetailIn,
    ChatTurnIn,
)

MAP_QUESTION_RULE = (
    "- When a result could be drawn on more than one of this instance's map providers and the analyst has not "
    "said which in this conversation, ask one question naming the providers (which map do they want), then use "
    "the answer for the rest of the conversation: draw with the vizChoiceId of a map choice on that provider."
)


@dataclass(frozen=True)
class AppliedPromotion:
    draft_id: str
    kind: str
    target_type: str
    target_id: str | None
    status: str
    receipts: tuple[dict[str, Any], ...]


@dataclass(frozen=True)
class TurnContext:
    instance: ChatInstanceIn | None
    data_sources: tuple[ChatDataSourceEntryIn, ...] | None
    ready_queries: tuple[ChatReadyQueryIn, ...]
    applied: tuple[AppliedPromotion, ...] = ()
    subject_detail: ChatSubjectDetailIn | None = None


EMPTY_CONTEXT = TurnContext(instance=None, data_sources=None, ready_queries=())


def context_from(payload: ChatTurnIn) -> TurnContext:
    return TurnContext(
        instance=payload.instance,
        data_sources=tuple(payload.data_sources) if payload.data_sources is not None else None,
        ready_queries=tuple(payload.ready_queries or ()),
        subject_detail=payload.subject_detail,
    )


def subject_block(context: TurnContext) -> str | None:
    subject = context.subject_detail
    if subject is None:
        return None
    if subject.kind == "new":
        return f"The analyst opened this conversation to create a new {subject.id}."
    editable = " (the analyst can edit it)" if subject.can_edit else ""
    head = f'This conversation was opened from {subject.kind} {subject.id} "{subject.name}"{editable}:'
    return "\n".join([head, *(f"- {line}" for line in subject.lines)])


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


def _step_text(receipt: dict[str, Any]) -> str:
    text = f"{receipt.get('step')} {receipt.get('outcome')}"
    error = receipt.get("error")
    return f"{text} ({error})" if error else text


def _applied_line(applied: AppliedPromotion) -> str:
    target = applied.target_id if applied.target_id is not None else "not created"
    line = f"- draft {applied.draft_id} ({applied.kind}) to {applied.target_type} {target}: {applied.status}."
    if applied.receipts:
        line += f" Steps: {', '.join(_step_text(one) for one in applied.receipts)}"
    return line


def applied_block(context: TurnContext) -> str | None:
    if not context.applied:
        return None
    lines = ["Applied since your last turn (the analyst clicked Apply in a card; treat these as saved):"]
    lines.extend(_applied_line(one) for one in context.applied)
    return "\n".join(lines)
