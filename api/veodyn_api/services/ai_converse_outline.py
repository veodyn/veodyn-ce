"""The report outline a conversation proposes, checked against what exists.

The model writes words, this module assigns ids. Unlike `build_outline` in
ai_outline.py, this one can also write the query a section needs.

`written_in_parallel` is shared with the dashboard builder and lives here because
ai_converse_proposals imports `report_proposal` from this module.
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from veodyn_api.schemas.ai import NewQueryProposalOut, OutlineSectionOut, ReportOutlineOut
from veodyn_api.schemas.ai_create import AnyProposalOut, QueryProposalOut, ReportProposalOut
from veodyn_api.services.ai_converse_grounding import Grounding
from veodyn_api.services.ai_converse_prompt import MAX_NEW_QUERIES_PER_REPORT, picked_id, text_of
from veodyn_api.services.ai_outline import NO_QUERY
from veodyn_api.services.ai_written_query import as_new_query, written_query
from veodyn_api.services.clickhouse import ClickHouseClient
from veodyn_api.services.llm import LlmClient, as_objects

logger = logging.getLogger(__name__)

# How many of a turn's new queries are written at once. Safe to share the
# LlmClient across them: one httpx.Client, and no database session is touched.
MAX_PARALLEL_WRITES = 4


def _row_label(row: dict[str, Any]) -> str:
    return text_of(row.get("title")) or text_of(row.get("name")) or text_of(row.get("datasetTable"), 255)


def written_in_parallel(
    llm: LlmClient,
    rows: dict[int, dict[str, Any]],
    grounding: Grounding,
    *,
    warehouse: ClickHouseClient | None = None,
) -> dict[int, QueryProposalOut | str]:
    """Each row's written query, or the reason there is none, keyed by row index.

    Keyed rather than ordered, so the caller assembles in the model's row order
    and not in completion order. The caller applies the cap in row order before
    submitting, or it would fall on whichever thread lost and two identical turns
    would propose different queries.

    An unexpected raise degrades that ONE row to a string reason rather than
    discarding the generations that already finished.
    """
    if not rows:
        return {}
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_WRITES) as pool:
        futures = {
            index: pool.submit(written_query, llm, row, grounding, warehouse=warehouse) for index, row in rows.items()
        }
    written: dict[int, QueryProposalOut | str] = {}
    for index, future in futures.items():
        try:
            written[index] = future.result()
        except Exception:
            label = _row_label(rows[index])
            logger.exception("writing the query for %r failed; the rest of the turn stands", label or index)
            written[index] = f"a query for {label!r}" if label else "a query this turn asked to be written"
    return written


def _source(row: dict[str, Any], known: set[int]) -> tuple[int | None, str | None, bool]:
    """Which of a section's three sources it named, and whether one must be written.

    Four cases:

    - An id the model was GIVEN resolves to that query.
    - An id it was NOT given is an invention, and refused rather than read as
      "no source", which would turn a broken answer into plausible prose.
    - No id but a table: a section asking for a query to be written.
    - Neither: prose.
    """
    named = row.get("queryId")
    if named is not None:
        picked = picked_id(named)
        if picked is None:
            return None, f"query {named!r}", False
        if picked != NO_QUERY:
            if picked not in known:
                return None, f"query {picked}", False
            return picked, None, False
    return None, None, bool(text_of(row.get("datasetTable"), 255))


def _section(row: dict[str, Any], source: int | None, new_query: NewQueryProposalOut | None) -> OutlineSectionOut:
    title = text_of(row.get("title"))
    suggested = bool(row.get("suggested"))
    return OutlineSectionOut(
        # Assigned by the caller: only it knows the section's position once the
        # unusable rows have been dropped.
        id="",
        title=title,
        intent=text_of(row.get("intent"), 10_000) or title,
        source_query_id=source,
        new_query=new_query,
        # A suggested section is an offer the reader toggles on, so it arrives
        # switched off. Same rule as build_outline.
        suggested=suggested,
        enabled=not suggested,
    )


def report_proposal(
    llm: LlmClient, raw: dict[str, Any], grounding: Grounding, *, warehouse: ClickHouseClient | None = None
) -> AnyProposalOut | str:
    """An outline of existing queries, queries to be written, prose, or all three."""
    nested = raw.get("outline")
    outline: dict[str, Any] = nested if isinstance(nested, dict) else {}
    known = {one.id for one in grounding.queries}
    # Dropped before classification, so a section number counts the sections that
    # survive rather than the rows that arrived.
    rows = [row for row in as_objects(outline.get("sections")) if text_of(row.get("title"))]

    sources: dict[int, int | None] = {}
    reasons: dict[int, str] = {}
    to_write: dict[int, dict[str, Any]] = {}
    for index, row in enumerate(rows):
        source, reason, wants_new = _source(row, known)
        if reason is not None:
            reasons[index] = reason
        elif not wants_new:
            sources[index] = source
        elif len(to_write) >= MAX_NEW_QUERIES_PER_REPORT:
            reasons[index] = f"more than {MAX_NEW_QUERIES_PER_REPORT} new queries in one report"
        else:
            to_write[index] = row

    new_queries: dict[int, NewQueryProposalOut] = {}
    for index, result in written_in_parallel(llm, to_write, grounding, warehouse=warehouse).items():
        if isinstance(result, str):
            reasons[index] = result
        else:
            new_queries[index] = as_new_query(result)

    if reasons:
        # Row order, so the degraded reply reads in the order the model listed the
        # sections whichever pass produced each reason.
        return ", ".join(reasons[index] for index in sorted(reasons))
    if not rows:
        return "any section to put in the report"
    goal = text_of(outline.get("goal"), 10_000) or "Data report"
    # Nothing was refused, so every surviving row produced a section.
    sections = [
        _section(row, sources.get(index), new_queries.get(index)).model_copy(update={"id": f"section-{index + 1}"})
        for index, row in enumerate(rows)
    ]
    return ReportProposalOut(outline=ReportOutlineOut(goal=goal, sections=sections))
