"""The report outline a conversation proposes, checked against what exists.

Split from ai_converse_proposals.py, where it was the longest of the five
builders by some way: a section has three possible sources where a widget has two,
and telling them apart is most of the code. The other four builders stayed
together; this one earns its own file.

Sibling of `build_outline` in ai_outline.py, not a copy of it. That one answers
`/ai/outline`, has no catalog and no generator, and so can only resolve or drop an
id. This one can also write the query a section needs, which is the whole reason
the two are separate calls.

The rule is the shared one: **the model writes words, this module assigns ids.**

`written_in_parallel` below is shared with the dashboard builder rather than
belonging to reports. It lives here because ai_converse_proposals imports
`report_proposal` from this module, so the import can only run in that direction;
a second copy of the pool is a second place for the cap and the failure
containment to drift apart.
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

# How many of a turn's new queries are written at once. Each one is an
# independent generation plus a safety check plus a DESCRIBE, all inside the turn
# the analyst is waiting on. Sequentially, four of them is four times one wait,
# which is what capped both kinds at four in the first place. They share nothing:
# one LlmClient holds one httpx.Client, which is safe across threads, and nothing
# here touches a database session.
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

    Keyed rather than ordered, so the caller assembles in the order the model
    asked for and not the order the generations happened to finish in. Which
    rows are in here at all is the caller's decision, taken in row order before
    anything is submitted: counted in the workers, the cap would fall on
    whichever thread lost, and two identical turns would propose different
    queries.

    An unexpected raise degrades that ONE row to the same kind of string reason
    an unresolvable table produces. Sequentially a raise took the turn with it,
    which was survivable because the rows before it had already been built; here
    it would throw away three generations the analyst has already waited for.
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

    No generation here, deliberately: the caller classifies every row before it
    submits any of them, which is what keeps the cap independent of scheduling.

    Four cases, and they are not the same:

    - An id the model was GIVEN resolves to that query.
    - An id it was NOT given is an invention, and refused. Reading it as "no
      source" would quietly turn a broken answer into a plausible prose section
      the analyst never sees a reason to doubt.
    - No id but a table: a section asking for a query to be written.
    - Neither: prose. A valid outline entry, and what every unanswerable section
      used to become whether the analyst wanted data there or not.
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
        # Assigned by the caller, which is the only thing that knows the
        # section's position once the unusable rows have been dropped.
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
    """An outline of existing queries, queries to be written, prose, or all three.

    Writing them is what this kind could not do before. A section nothing in the
    list answered became prose, so a report about something the instance had no
    query for was a report with no data in it, while ai-report.ts documented the
    opposite: "null = the AI will generate one". Nothing generated one.
    """
    nested = raw.get("outline")
    outline: dict[str, Any] = nested if isinstance(nested, dict) else {}
    known = {one.id for one in grounding.queries}
    # A titleless row is dropped before anything is classified, so a section
    # number counts the sections that survive rather than the rows that arrived.
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
        # Row order, so the degraded reply reads in the order the model listed
        # the sections whichever pass produced each reason.
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
