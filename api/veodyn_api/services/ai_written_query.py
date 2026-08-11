"""The one place a Create-with-AI turn writes SQL.

Split out of ai_converse_proposals.py, which now assigns ids and nothing else.
This is the only part of the proposal path that calls the model a second time, so
it is also the only part that can be slow, cost a retry, or refuse: keeping it
apart means the module carrying the id-safety rule has no generation in it.

Four kinds reach this. A `query` conversation is nothing but this call. A
dashboard widget, a KPI, and a report section reach it when the analyst asked for
something no existing query answers, and the alternative to writing it was
telling them to go and make it by hand.

All four go through ONE generator and therefore one safety check. A second path
here would be a second thing to keep correct, and the one that got out of date
would be the one guarding SQL an analyst runs.
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
    """The same query, minus the `kind` discriminator its container does not want.

    Every caller that hangs a written query off something else does this, so it is
    one function: a dashboard widget, a KPI and a report section all create it with
    the same call and differ only in what they point at afterwards.
    """
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

    `viz` overrides the shape rather than reading the model's `vizChoiceId`, for
    the caller that never asked it to choose one. A KPI is the case: its source
    query is the series its sparkline and history read, so the shape is known
    from the kind, and sending the whole shape guide to a KPI interview would
    spend the transcript's prompt budget on a field with one right answer.

    `warehouse` is what makes the second half possible and is optional for a
    reason: without it (no ClickHouse configured, or a caller that has not been
    wired yet) this returns exactly what it returned before, a query with a shape
    and no options, and the frontend infers the rest. Everything the warehouse
    adds here is cosmetic by construction.

    A string return is not an error. An unresolvable table is an answer the
    analyst has to see and can correct, which is why the caller turns it into a
    degraded turn rather than a 502.
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
    # cardinality and real ranges rather than against a column list.
    profile = cached_profile(warehouse, dataset) if warehouse is not None else None
    try:
        # The existing generator, so the one-statement, read-only, right-table
        # check and its retry-with-reason apply unchanged.
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

    Ordered deliberately: validate_sql has already run inside generate_sql, so
    DESCRIBE is only ever given a statement that passed the single read-only
    SELECT check. Nothing here can fail the proposal; each step answers with
    nothing and the next one copes.
    """
    if warehouse is None:
        return {}
    columns = describe_result(warehouse, sql)
    if not columns:
        return {}
    viz_type = viz_type_for(shape)
    asked = author_options(llm, viz_type=viz_type, shape=shape, intent=intent, columns=columns)
    return bind_options(viz_type, shape, asked, columns)
