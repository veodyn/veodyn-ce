import json
from dataclasses import dataclass
from typing import Any

from veodyn_api.errors import ApiError
from veodyn_api.schemas.ai import AiDatasetIn
from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.services.ai_sql import QUERYABLE_TABLE_RE, UngroundedSql, validate_generic_sql, validate_sql
from veodyn_api.services.ai_text import text_of
from veodyn_api.services.chat.tool_types import DataSourceInfo, Immediate, ToolContext, positive_id

MAX_NAMED_TABLES = 20
MAX_RESOURCE_CALL_CHARS = 4_000
SECOND_REFUSAL = (
    " This is the second refusal in this turn: stop writing SQL and tell the analyst what you could not do."
)
CANNOT_QUERY_YET = "chat cannot query this data source yet"


def _resolve(ctx: ToolContext, arguments: dict[str, Any]) -> DatasetOut | Immediate:
    wanted = text_of(arguments.get("datasetTable"), 255).lower()
    queryable = [one for one in ctx.datasets if QUERYABLE_TABLE_RE.match(one.id)]
    exact = [one for one in queryable if one.id.lower() == wanted]
    bare = [one for one in queryable if one.id.lower().rpartition(".")[2] == wanted.rpartition(".")[2]]
    if wanted and exact:
        return exact[0]
    if wanted and len(bare) == 1:
        return bare[0]
    names = ", ".join(one.id for one in queryable[:MAX_NAMED_TABLES]) or "none"
    return Immediate(f"there is no table called {wanted!r}. The tables you may read are: {names}", is_error=True)


def _checked_sql(ctx: ToolContext, arguments: dict[str, Any], dataset: DatasetOut) -> str | Immediate:
    try:
        return validate_sql(text_of(arguments.get("sql"), 50_000), AiDatasetIn(table=dataset.id, columns=[]))
    except UngroundedSql as refused:
        ctx.refusals += 1
        message = f"the SQL was refused because {refused}. Rewrite it."
        return Immediate(message + (SECOND_REFUSAL if ctx.refusals >= 2 else ""), is_error=True)


@dataclass(frozen=True)
class Target:
    data_source_id: int
    dataset: DatasetOut | None
    info: DataSourceInfo | None


async def resolve_target(ctx: ToolContext, arguments: dict[str, Any]) -> Target | Immediate:
    dataset_table = arguments.get("datasetTable")
    explicit_id = arguments.get("dataSourceId")
    if isinstance(dataset_table, str) and dataset_table.strip():
        if explicit_id is not None:
            return Immediate(
                "give either datasetTable (the warehouse catalog) or dataSourceId (another data source), not both",
                is_error=True,
            )
        dataset = _resolve(ctx, arguments)
        if isinstance(dataset, Immediate):
            return dataset
        try:
            warehouse_id = await ctx.data_source_id()
        except ApiError as unresolvable:
            return Immediate(f"the query cannot run on this instance: {unresolvable.message}", is_error=True)
        return Target(data_source_id=warehouse_id, dataset=dataset, info=None)

    source_id = positive_id(explicit_id)
    if source_id is None:
        return Immediate(
            "give datasetTable to query the warehouse catalog, or dataSourceId (from list_data_sources) for "
            "another data source",
            is_error=True,
        )
    try:
        existing_warehouse_id: int | None = await ctx.data_source_id()
    except ApiError:
        existing_warehouse_id = None
    if existing_warehouse_id is not None and source_id == existing_warehouse_id:
        return Immediate("this id is the warehouse; give datasetTable to query it, not dataSourceId", is_error=True)
    info = ctx.data_source_info(source_id)
    if info is None or not info.syntax:
        return Immediate(
            "call list_data_sources first so this data source's kind is known before querying it", is_error=True
        )
    if info.view_only:
        return Immediate(
            "this data source is view-only for the analyst's account; ad-hoc queries cannot run against it",
            is_error=True,
        )
    if info.syntax not in ("sql", "json"):
        return Immediate(CANNOT_QUERY_YET, is_error=True)
    return Target(data_source_id=source_id, dataset=None, info=info)


def checked_body(ctx: ToolContext, arguments: dict[str, Any], target: Target) -> str | Immediate:
    if target.dataset is not None:
        if arguments.get("resourceCall") is not None:
            return Immediate("this data source takes sql, not resourceCall", is_error=True)
        return _checked_sql(ctx, arguments, target.dataset)

    assert target.info is not None
    if target.info.syntax == "sql":
        if arguments.get("resourceCall") is not None:
            return Immediate("this data source takes sql, not resourceCall", is_error=True)
        try:
            return validate_generic_sql(text_of(arguments.get("sql"), 50_000))
        except UngroundedSql as refused:
            ctx.refusals += 1
            message = f"the SQL was refused because {refused}. Rewrite it."
            return Immediate(message + (SECOND_REFUSAL if ctx.refusals >= 2 else ""), is_error=True)

    if arguments.get("sql") is not None:
        return Immediate("this data source takes resourceCall, not sql", is_error=True)
    call = arguments.get("resourceCall")
    if not isinstance(call, dict):
        return Immediate("give resourceCall: {resource, params} for this data source", is_error=True)
    resource = text_of(call.get("resource"), 128)
    if not resource:
        return Immediate("resourceCall.resource must name a resource this data source documents", is_error=True)
    registry = target.info.resources
    if registry is None:
        return Immediate(
            "call describe_data_source for this data source before writing a resourceCall; its resource names "
            "are not known yet",
            is_error=True,
        )
    if resource not in registry:
        names = ", ".join(sorted(registry)) or "none"
        message = f"there is no resource called {resource!r} on this data source. Available: {names}"
        return Immediate(message, is_error=True)
    params = call.get("params")
    params = params if isinstance(params, dict) else {}
    declared = registry[resource]
    unexpected = sorted(set(params) - set(declared))
    if unexpected:
        allowed = ", ".join(declared) or "none"
        return Immediate(
            f"resourceCall.params named {unexpected[0]!r}, which this resource does not take. Allowed: {allowed}",
            is_error=True,
        )
    serialized = json.dumps({"resource": resource, "params": params}, separators=(",", ":"))
    if len(serialized) > MAX_RESOURCE_CALL_CHARS:
        message = f"resourceCall is too large (over {MAX_RESOURCE_CALL_CHARS} characters); keep params small"
        return Immediate(message, is_error=True)
    return serialized
