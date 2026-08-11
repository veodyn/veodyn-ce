"""What the model named, checked against what it was given.

Split out of ai_converse.py, which now holds only the turn itself, with the
generator in ai_written_query.py and the report outline (the longest of the five
builders) in ai_converse_outline.py. The rule these builders share is the one the
whole feature rests on: **the model writes words, this module assigns ids.** Each
answers either a proposal whose every id came out of the grounding list, or a
STRING naming what it could not resolve, which the caller turns into a degraded
turn.

Returning a reason rather than raising is deliberate. An unresolvable id is not
an error, it is an answer the analyst has to see: "I could not find a query
called that" is a turn they can correct, and a 502 is not.

Four of the five kinds may also ask for a query that does not exist yet and get
it written for them. That does not weaken the rule above. A written query has no
id at all until the card creates it, so there is still nothing here for the model
to invent.
"""

from collections.abc import Callable
from typing import Any

from veodyn_api.schemas.ai import NewQueryProposalOut
from veodyn_api.schemas.ai_create import (
    AnyProposalOut,
    ConverseOut,
    CreateKind,
    KpiProposalOut,
    SnippetProposalOut,
)
from veodyn_api.services.ai_converse_dashboard import Built, VisualizationResolver, dashboard_proposal
from veodyn_api.services.ai_converse_grounding import Grounding
from veodyn_api.services.ai_converse_outline import report_proposal
from veodyn_api.services.ai_converse_prompt import (
    CADENCES,
    DIRECTIONS,
    KPI_SOURCE_VIZ,
    one_of,
    picked_id,
    text_of,
)
from veodyn_api.services.ai_grounding import DashboardWidget
from veodyn_api.services.ai_written_query import as_new_query, written_query
from veodyn_api.services.clickhouse import ClickHouseClient
from veodyn_api.services.llm import LlmClient

# What a query's last result actually returned, injected as a callable rather
# than resolved from a Redash client here, so this module does no I/O of its own.
# Empty is "we could not find out", never "it returns nothing".
ResultColumns = Callable[[int], tuple[str, ...]]


def degraded(unresolved: str, focus_table: str | None = None) -> ConverseOut:
    """A turn the model called ready whose picks did not survive the lookup.

    The reply is written HERE rather than taken from the answer. The model's own
    reply for a ready turn says "here is your dashboard", and shipping that
    beside a dropped proposal would tell the analyst something exists when
    nothing does.

    `focus_table` is carried through rather than dropped: the proposal failed,
    the conversation is still about the same table, and losing it here would
    cost the next turn the profile it is trying to correct the proposal with.
    """
    return ConverseOut(
        reply=(
            f"I could not resolve {unresolved}, so I have not proposed anything yet. "
            "Tell me more about what you need and I will try again."
        ),
        suggested_answers=[],
        ready=False,
        proposal=None,
        focus_table=focus_table,
    )


def partial_note(reply: str, dropped: str, held_removals: bool = False) -> str:
    """The model's reply, plus what did not survive the lookup.

    The counterpart to `degraded` for a turn that produced SOMETHING. Its reply
    is written by the model and stays, because it describes a proposal that does
    exist; this appends the part the model has no way to know about. Saying
    nothing is the failure mode worth avoiding: a card showing five widgets
    under a sentence that promised six reads as the card being wrong.

    The second sentence matters just as much and is easier to forget. When a row
    is dropped, the answer stops being about the whole dashboard, so nothing is
    removed from it (see _nothing_removed). If the reader ASKED for a widget to
    go, the reply above may well say it is going, and it is not. Whoever reads
    this has to be told which of the two things happened.
    """
    if not dropped:
        return reply
    note = f"{reply}\n\nI could not resolve {dropped}, so that is not in the proposal."
    if held_removals:
        note += (
            " Because part of this answer is missing, I have left every widget already on the "
            "dashboard in place rather than risk removing one you did not ask about. Ask again "
            "if you still want something removed."
        )
    return note


def _query_proposal(
    llm: LlmClient, raw: dict[str, Any], grounding: Grounding, warehouse: ClickHouseClient | None
) -> AnyProposalOut | str:
    return written_query(llm, raw, grounding, warehouse=warehouse)


def _kpi_proposal(
    llm: LlmClient,
    raw: dict[str, Any],
    grounding: Grounding,
    warehouse: ClickHouseClient | None,
    columns_of: ResultColumns | None,
) -> AnyProposalOut | str:
    """A KPI over a query that exists, or over one written for it.

    A KPI reads one number from one query, so there is no cap here: it needs
    exactly one source, and this decides which of the two kinds it is.

    The written branch is what this kind could not do before, and the refusal was
    visible to users. Asked for a KPI its instance had no query for, the model
    answered that it could not author SQL in this flow and asked the analyst to
    choose from a list that did not contain what they wanted.

    `viz` is fixed rather than read from the answer. This kind is not sent the
    shape guide (VIZ_KINDS), so the model was never asked to choose a shape, and
    a KPI's source is the series its sparkline and history read.
    """
    picked = picked_id(raw.get("queryId"))
    query = {one.id: one for one in grounding.queries}.get(picked) if picked is not None else None
    new_query: NewQueryProposalOut | None = None
    if query is None:
        # An id that was named and did not resolve is an invention, and saying so
        # is more useful than quietly writing a different query instead. Only a
        # turn naming NO query at all is one asking for a query to be written.
        if picked is not None:
            return f"query {picked}"
        written = written_query(llm, raw, grounding, viz=KPI_SOURCE_VIZ, warehouse=warehouse)
        if isinstance(written, str):
            # No usable table either, so there is nothing to write from. The
            # analyst can answer with either half, so the reason names both.
            return f"{written}, or which query the KPI reads"
        new_query = as_new_query(written)
    column = text_of(raw.get("valueColumn"), 255)
    if not column:
        return "which result column holds the value"
    if query is not None and columns_of is not None:
        # The model has always been free to name any column here and nothing
        # checked it. A KPI pointing at a column its query does not return never
        # evaluates, and it fails later, on a schedule, where nobody is watching.
        # Only for an EXISTING query: a written one has no result to read a
        # column list off until the card creates it.
        returns = columns_of(query.id)
        if returns and column not in returns:
            return f"a column called {column!r} in {query.name!r} (it returns {', '.join(returns)})"
    target = raw.get("target")
    # One of the two is always set by here: `query` when an id resolved, and
    # `new_query` otherwise, since every other path returned a reason.
    fallback_name = query.name if query is not None else new_query.name if new_query is not None else ""
    return KpiProposalOut(
        name=text_of(raw.get("name")) or fallback_name,
        description=text_of(raw.get("description"), 4_000),
        source_query_id=query.id if query is not None else None,
        new_query=new_query,
        value_column=column,
        unit=text_of(raw.get("unit"), 64) or None,
        # Null is "they gave no target". Zero is a target: "zero dropped feeds"
        # is a KPI someone asks for here, and a truthiness check would answer it
        # with a blank field and a Create button that will not press.
        target=float(target) if isinstance(target, int | float) and not isinstance(target, bool) else None,
        direction=one_of(raw.get("direction"), DIRECTIONS, "higher-is-better"),
        cadence=one_of(raw.get("cadence"), CADENCES, "daily"),
        # Read the same way as target, and for the same reason: zero is a band
        # somebody asks for here. KpiProposalOut drops the pair when only one
        # arrives or when the two would erase a band, so nothing downstream has
        # to hold a half-stated one.
        at_risk=_number_or_none(raw.get("atRisk")),
        breached=_number_or_none(raw.get("breached")),
    )


def _number_or_none(value: Any) -> float | None:
    """A real number, or None. Bools are not numbers here, whatever Python says."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def _snippet_proposal(raw: dict[str, Any]) -> AnyProposalOut | str:
    trigger = text_of(raw.get("trigger"), 255)
    snippet = text_of(raw.get("snippet"), 10_000)
    if not trigger or not snippet:
        return "a trigger and a snippet body"
    return SnippetProposalOut(trigger=trigger, snippet=snippet, description=text_of(raw.get("description"), 4_000))


def build_proposal(
    llm: LlmClient,
    kind: CreateKind,
    raw: dict[str, Any],
    grounding: Grounding,
    resolve: VisualizationResolver | None,
    *,
    warehouse: ClickHouseClient | None = None,
    columns_of: ResultColumns | None = None,
    editing: tuple[DashboardWidget, ...] = (),
) -> Built:
    """The proposal, and anything that could not go in it. One branch per kind.

    Four of the five kinds resolve a single source and so are all-or-nothing:
    their reason string becomes a Built with no proposal. A dashboard is the one
    that can come back partial, which is why Built exists at all.
    """
    if kind == "dashboard":
        return dashboard_proposal(llm, raw, grounding, resolve, warehouse, editing)
    if kind == "query":
        return _as_built(_query_proposal(llm, raw, grounding, warehouse))
    if kind == "kpi":
        return _as_built(_kpi_proposal(llm, raw, grounding, warehouse, columns_of))
    if kind == "report":
        return _as_built(report_proposal(llm, raw, grounding, warehouse=warehouse))
    return _as_built(_snippet_proposal(raw))


def _as_built(result: AnyProposalOut | str) -> Built:
    """One of the all-or-nothing kinds, in the shape every caller reads."""
    return Built(None, result) if isinstance(result, str) else Built(result)
