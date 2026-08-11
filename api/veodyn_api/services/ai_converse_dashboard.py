"""Turning the model's widget list into one a dashboard can be built from.

Split out of ai_converse_proposals.py for the same reason ai_converse_outline.py
was: it is the longest of the five builders and the only one with a second
dimension to resolve. The others answer "which query", this one answers "which
query, drawn how", and the second half is where an EDIT differs from a creation.

The rule is the one the whole feature rests on, unchanged: the model writes
words, this module assigns ids. It names a query from the grounded list and a
SHAPE from a closed vocabulary, and every id in the result was looked up here.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from veodyn_api.schemas.ai_create import (
    AnyProposalOut,
    DashboardProposalOut,
    DashboardWidgetProposalOut,
)
from veodyn_api.services.ai_converse_grounding import Grounding
from veodyn_api.services.ai_converse_outline import written_in_parallel
from veodyn_api.services.ai_converse_prompt import MAX_NEW_QUERIES_PER_DASHBOARD, picked_id, text_of
from veodyn_api.services.ai_grounding import (
    DashboardWidget,
    GroundedQuery,
    QueryVisualization,
    default_visualization,
)
from veodyn_api.services.ai_viz_choice import choice_id_for, viz_choice
from veodyn_api.services.ai_written_query import as_new_query
from veodyn_api.services.clickhouse import ClickHouseClient
from veodyn_api.services.llm import LlmClient, as_objects

# A dashboard widget points at a visualization, so the proposal needs a second
# real id per widget. Injected as a callable rather than resolved from a Redash
# client here, so this module does no I/O of its own.
#
# Every visualization rather than one id: an edit turn asks "does this query
# already HAVE a bar chart", and the answer decides between pointing a widget at
# one and telling the client to create it. One call per named query either way.
VisualizationResolver = Callable[[int], tuple[QueryVisualization, ...]]


@dataclass(frozen=True)
class Built:
    """A proposal, and whatever could not be put into one.

    Defined here rather than beside build_proposal because a dashboard is the
    only kind that can come back partial: the other four resolve one source and
    are all-or-nothing. build_proposal adopts it as its uniform return so a
    caller reads one shape whichever kind answered.

    Before this, a single unresolvable widget threw away the whole answer. Six
    widgets resolved, one did not, and the analyst was told "I could not resolve
    query 50, so I have not proposed anything yet". `dropped` is what lets the
    survivors be offered while still naming what is missing, rather than quietly
    shipping a shorter list than the model described.

    `proposal` is None only when nothing survived, which is still a degraded turn.
    """

    proposal: AnyProposalOut | None
    dropped: str = ""
    # Whether a partial answer put widgets back that the model left out. The
    # reader has to be told: they may have ASKED for one of those to go, and a
    # card that quietly keeps it under a reply promising it is gone is the
    # failure this whole change is about.
    held_removals: bool = False


def _widget_over_existing_query(
    row: dict[str, Any],
    query: GroundedQuery,
    current: DashboardWidget | None,
    resolve: VisualizationResolver | None,
) -> DashboardWidgetProposalOut | str:
    """One widget over a query that already exists, or why there is none.

    Three cases, told apart by the shape the model asked for:

    * No shape asked for. The widget is being kept as it is drawn, so it points
      at what it points at today. A widget being ADDED has no "today", so the
      query's own default is used instead: the same first-configured-shape rule
      query_visualization_id applies to a creation turn.
    * A shape the query already has. The widget points at that visualization and
      nothing is written to the query.
    * A shape it does not have. The id is left null and the shape carried
      instead, which is the client's instruction to create one. That is the only
      branch that writes to a saved query, and the client checks who owns it
      before it does.
    """
    asked = text_of(row.get("vizChoiceId"), 64)
    options = resolve(query.id) if resolve else ()
    title = text_of(row.get("title")) or query.name
    if not asked:
        if current is not None and current.viz_id:
            # What it is drawn as today, named so the client can see this widget
            # is being kept rather than changed.
            return DashboardWidgetProposalOut(
                title=title,
                query_id=query.id,
                visualization_id=current.viz_id,
                viz_choice_id=(choice_id_for(current.viz_type, current.viz_options) if current.viz_type else None),
                new_query=None,
            )
        default = default_visualization(options)
        if default is None:
            return f"a visualization for {query.name!r}"
        return DashboardWidgetProposalOut(
            title=title,
            query_id=query.id,
            visualization_id=default.id,
            viz_choice_id=choice_id_for(default.type, default.options),
            new_query=None,
        )

    chosen = viz_choice(asked)
    match = next((one for one in options if choice_id_for(one.type, one.options) == chosen), None)
    return DashboardWidgetProposalOut(
        title=title,
        query_id=query.id,
        # Null when the query has no visualization of that shape: the client
        # creates one, forking the query first when the reader does not own it.
        visualization_id=match.id if match is not None else None,
        viz_choice_id=chosen,
        new_query=None,
    )


def dashboard_proposal(
    llm: LlmClient,
    raw: dict[str, Any],
    grounding: Grounding,
    resolve: VisualizationResolver | None,
    warehouse: ClickHouseClient | None,
    editing: tuple[DashboardWidget, ...] = (),
) -> Built:
    """A dashboard of existing queries, queries to be written, or both.

    A widget naming a `queryId` is assembled from what exists. A widget naming a
    `datasetTable` instead is written here, by the same generator the query
    conversation uses, and the card creates it before it hangs it on the
    dashboard. Writing them is what this kind could not do before: it was
    grounded on the query list alone, so the only honest answer to "build me a
    dashboard of things that do not exist yet" was to send the analyst away to
    make each one by hand.

    Two passes, because writing is the slow half. The first classifies every row
    without calling the model, which is where the cap is spent and therefore why
    which widgets get written does not depend on which thread got there first.
    The second runs the writes together.

    A row that cannot be resolved drops that ROW rather than the answer. The
    all-or-nothing version turned one widget the model named badly into "I have
    not proposed anything yet" for the five it named well, and on an edit the
    widget that fails is usually one nobody asked to touch.
    """
    known = {one.id: one for one in grounding.queries}
    # What the dashboard draws today, by query, so a kept widget keeps its own
    # visualization rather than being re-resolved to the query's default.
    # Without it an edit that changed nothing still proposed a different picture
    # for any query whose author added a chart after the widget was made.
    on_dashboard = {widget.query_id: widget for widget in editing}
    rows = as_objects(raw.get("widgets"))
    built: dict[int, DashboardWidgetProposalOut] = {}
    reasons: dict[int, str] = {}
    to_write: dict[int, dict[str, Any]] = {}
    for index, row in enumerate(rows):
        picked = picked_id(row.get("queryId"))
        query = known.get(picked) if picked is not None else None
        if query is None and picked is None:
            # No existing query named, so this widget is one to write.
            if len(to_write) >= MAX_NEW_QUERIES_PER_DASHBOARD:
                reasons[index] = f"more than {MAX_NEW_QUERIES_PER_DASHBOARD} new queries in one dashboard"
            else:
                to_write[index] = row
            continue
        if query is None:
            reasons[index] = f"query {picked}"
            continue
        # Only the picked queries are looked up. Resolving the whole grounding
        # list would be sixty HTTP calls per ready turn for the six ids that
        # were named, which is the economy post_report already makes.
        widget = _widget_over_existing_query(row, query, on_dashboard.get(query.id), resolve)
        if isinstance(widget, str):
            reasons[index] = widget
            continue
        built[index] = widget

    for index, result in written_in_parallel(llm, to_write, grounding, warehouse=warehouse).items():
        if isinstance(result, str):
            reasons[index] = result
            continue
        built[index] = DashboardWidgetProposalOut(
            title=text_of(to_write[index].get("title")) or result.name,
            query_id=None,
            visualization_id=None,
            viz_choice_id=None,
            new_query=as_new_query(result),
        )

    # Row order, so the reason reads in the order the model listed the widgets,
    # whichever pass produced each one.
    dropped = ", ".join(reasons[index] for index in sorted(reasons))
    if not built:
        return Built(None, dropped or "any query to put on the dashboard")
    widgets = [built[index] for index in sorted(built)]
    complete = widgets if not dropped else _nothing_removed(widgets, editing)
    return Built(
        DashboardProposalOut(name=text_of(raw.get("name")) or "New dashboard", widgets=complete),
        dropped,
        held_removals=len(complete) > len(widgets),
    )


def _nothing_removed(
    widgets: list[DashboardWidgetProposalOut], editing: tuple[DashboardWidget, ...]
) -> list[DashboardWidgetProposalOut]:
    """The proposal, plus every widget still on the dashboard it does not name.

    Only for a PARTIAL answer, and it is what stops dropping a row from turning
    into deleting a panel. The client reads this list as the dashboard's END
    STATE and removes anything missing from it, which is right when the model
    answered about the whole dashboard and wrong when a row fell out on the way:
    a model that garbled query 11 into query 4242 would have the widget for 11
    deleted for it.

    Appended drawn exactly as they are now, so they arrive as `keep` rather than
    as changes. The rule this buys is worth stating plainly: a partial answer
    changes what it resolved and removes nothing.
    """
    named = {one.query_id for one in widgets if one.query_id is not None}
    kept = list(widgets)
    for widget in editing:
        # A widget with no visualization id cannot be pointed at, so there is
        # nothing to put in the list for it. dashboard_widgets only yields
        # widgets that HAVE a visualization, so this is a Redash payload that
        # reported one without an id rather than a case anyone can reach.
        if widget.query_id in named or not widget.viz_id:
            continue
        named.add(widget.query_id)
        kept.append(
            DashboardWidgetProposalOut(
                title=widget.query_name,
                query_id=widget.query_id,
                visualization_id=widget.viz_id,
                viz_choice_id=choice_id_for(widget.viz_type, widget.viz_options) if widget.viz_type else None,
                new_query=None,
            )
        )
    return kept
