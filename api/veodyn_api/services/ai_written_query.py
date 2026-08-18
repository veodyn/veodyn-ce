"""The one place a Create-with-AI turn writes SQL.

Four kinds reach this: a `query` conversation, and a dashboard widget, KPI or
report section when no existing query answers the ask. All four go through ONE
generator and therefore one safety check.
"""

from typing import Any

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.schemas.ai import (
    AiDatasetColumnIn,
    AiDatasetIn,
    GenerateSqlIn,
    NewQueryProposalOut,
)
from veodyn_api.schemas.ai_create import QueryProposalOut
from veodyn_api.services.ai_converse_grounding import Grounding
from veodyn_api.services.ai_converse_prompt import MAX_GROUNDED_COLUMNS, text_of
from veodyn_api.services.ai_sql import generate_sql
from veodyn_api.services.ai_viz_choice import viz_choice, viz_type_for
from veodyn_api.services.clickhouse import ClickHouseClient
from veodyn_api.services.dataset_profile_cache import cached_profile
from veodyn_api.services.llm import LlmClient, compact_json
from veodyn_api.services.result_shape import describe_result
from veodyn_api.services.viz_binding import bind_options
from veodyn_api.services.viz_options import author_options


def as_new_query(written: QueryProposalOut) -> NewQueryProposalOut:
    """The same query, minus the `kind` discriminator its container does not want."""
    return NewQueryProposalOut(
        name=written.name,
        description=written.description,
        sql=written.sql,
        dataset_table=written.dataset_table,
        viz_choice_id=written.viz_choice_id,
        viz_options=written.viz_options,
    )


def written_query(
    llm: LlmClient,
    raw: dict[str, Any],
    grounding: Grounding,
    *,
    viz: str | None = None,
    warehouse: ClickHouseClient | None = None,
) -> QueryProposalOut | str:
    """A query written from a table the model named, and how to draw it.

    `viz` overrides the shape for a caller that never asked the model to choose
    one, which is the KPI case. Without `warehouse` this returns a query with a
    shape and no options and the frontend infers the rest, so everything the
    warehouse adds here is cosmetic.

    A string return is not an error: an unresolvable table becomes a degraded turn
    the analyst can correct, not a 502.
    """
    table = text_of(raw.get("datasetTable"), 255)
    dataset = next((one for one in grounding.datasets if one.id.lower() == table.lower()), None)
    if dataset is None:
        return f"a table called {table!r}" if table else "which table you meant"

    columns = [
        AiDatasetColumnIn(name=column.name, type=column.type, description=column.description)
        for column in dataset.schema_[:MAX_GROUNDED_COLUMNS]
    ]
    intent = text_of(raw.get("intent"), 10_000) or text_of(raw.get("description"), 10_000) or dataset.name
    # What the table currently holds, so the statement is written against real
    # cardinality and ranges rather than against a column list.
    profile = cached_profile(warehouse, dataset) if warehouse is not None else None
    try:
        # generate_sql applies the one-statement, read-only, right-table check and
        # its retry-with-reason.
        generated = generate_sql(
            llm,
            GenerateSqlIn(prompt=intent, dataset=AiDatasetIn(table=dataset.id, columns=columns)),
            profile_block=compact_json(profile.as_prompt_block()) if profile else None,
        )
    except ApiError as refused:
        if refused.error_id is not ErrorId.AI_UNGROUNDED:
            raise  # a provider failure is transport: the caller gets its 502
        return f"SQL over {dataset.id} that passed the safety check"

    shape = viz if viz is not None else viz_choice(raw.get("vizChoiceId"))
    return QueryProposalOut(
        name=text_of(raw.get("name")) or text_of(raw.get("title")) or dataset.name,
        description=text_of(raw.get("description"), 4_000) or generated.rationale,
        sql=generated.sql,
        dataset_table=dataset.id,
        viz_choice_id=shape,
        viz_options=_options_for(llm, shape, intent, generated.sql, warehouse),
    )


def _options_for(
    llm: LlmClient, shape: str, intent: str, sql: str, warehouse: ClickHouseClient | None
) -> dict[str, Any]:
    """How to draw the statement that was just written.

    Order is load-bearing: validate_sql has already run inside generate_sql, so
    DESCRIBE only ever sees a statement that passed the read-only SELECT check.
    Nothing here can fail the proposal.
    """
    if warehouse is None:
        return {}
    columns = describe_result(warehouse, sql)
    if not columns:
        return {}
    viz_type = viz_type_for(shape)
    asked = author_options(llm, viz_type=viz_type, shape=shape, intent=intent, columns=columns)
    return bind_options(viz_type, shape, asked, columns)
