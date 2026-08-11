// Turning a proposed widget list into a change to a dashboard that exists.
//
// The model is asked for the list the dashboard should END UP with, not for a
// set of operations, and the difference is computed here against the widgets
// really on it. That division is the same one the whole Create-with-AI path
// rests on: the model writes words, this half assigns ids. Asking it to name
// what to delete would hand a destructive operation to the half that cannot be
// trusted with an id, and a hallucinated widget id is a widget somebody else
// was using.

import type { DashboardWidgetProposal } from '@/types/ai-create'

export interface ExistingWidget {
  id: number
  queryId: number | null
  // What the panel points at today. Carried because a widget IS a visualization
  // of a query: without it the difference below can only see which queries are
  // on the dashboard, and "draw this query as a bar chart instead" is invisible
  // to it. That was the whole of the "No change to this dashboard" report under
  // a proposal describing six changes.
  visualizationId: number | null
  title: string
}

/** An existing panel and what the proposal says it should become. */
export interface WidgetChange {
  widget: ExistingWidget
  proposal: DashboardWidgetProposal
}

export interface DashboardEdit {
  add: DashboardWidgetProposal[]
  remove: ExistingWidget[]
  change: WidgetChange[]
  keep: ExistingWidget[]
}

/**
 * What to do to `current` to arrive at `proposed`.
 *
 * Matched on queryId, because that is the only identity the two sides share:
 * the proposal names queries, and a widget is a visualization OF a query. Two
 * widgets over the same query are treated as one match and the extra is left
 * alone rather than removed, since nothing in the proposal distinguishes them
 * and removing the wrong one is worse than leaving a duplicate.
 *
 * A widget with no query (a text box) is never in `remove`. The conversation is
 * grounded on query-backed widgets only, so the model has never been told text
 * boxes exist and its list saying nothing about them is not it asking for them
 * to go.
 *
 * A PROPOSED widget carrying a query to be written has no id to compare, so it
 * is always an addition and never keeps an existing panel alive: there is
 * nothing on the dashboard it could be the same as.
 *
 * A widget whose query stays but whose visualization does not is a `change`.
 * Redash cannot repoint a widget (its update endpoint writes `text` and
 * `options` only), so applying one is a delete followed by a create, which is
 * why it is its own bucket rather than a remove and an add that happen to
 * cancel out in the summary.
 */
export function dashboardEdit(
  current: ExistingWidget[],
  proposed: DashboardWidgetProposal[]
): DashboardEdit {
  const currentQueryIds = new Set(
    current.map((widget) => widget.queryId).filter((id): id is number => id != null)
  )
  // The first proposal per query, so two proposed widgets over one query cannot
  // both claim the same panel. The rest fall through to `add` below.
  const proposalFor = new Map<number, DashboardWidgetProposal>()
  for (const widget of proposed) {
    if (widget.queryId == null || proposalFor.has(widget.queryId)) continue
    proposalFor.set(widget.queryId, widget)
  }

  // Exactly one current panel per query answers the proposal for that query;
  // any other panel over the same query is one nothing in the proposal names,
  // and is left exactly as it is.
  //
  // Chosen before the loop below, because a panel that ALREADY draws what was
  // proposed is the one the proposal is describing. Taking the first one
  // instead would rebuild a duplicate to match its twin: two panels on query
  // 11, one already a bar chart, and a proposal asking for a bar chart would
  // redraw the other one, which nobody asked for.
  const answering = new Map<number, number>()
  for (const widget of current) {
    if (widget.queryId == null) continue
    const proposal = proposalFor.get(widget.queryId)
    if (proposal === undefined) continue
    if (!answering.has(widget.queryId)) {
      answering.set(widget.queryId, widget.id)
      continue
    }
    if (!isRedrawn(widget, proposal)) answering.set(widget.queryId, widget.id)
  }

  const keep: ExistingWidget[] = []
  const remove: ExistingWidget[] = []
  const change: WidgetChange[] = []
  for (const widget of current) {
    if (widget.queryId == null) {
      keep.push(widget)
      continue
    }
    const proposal = proposalFor.get(widget.queryId)
    if (proposal === undefined) {
      remove.push(widget)
      continue
    }
    if (answering.get(widget.queryId) !== widget.id || !isRedrawn(widget, proposal)) {
      keep.push(widget)
      continue
    }
    change.push({ widget, proposal })
  }

  return {
    // A query already on the dashboard is never an addition, however many times
    // the proposal names it: the panel that answers for it is above, and the
    // repeat is the same "one match per query" rule the removals follow.
    add: proposed.filter(
      (widget) => widget.queryId == null || !currentQueryIds.has(widget.queryId)
    ),
    remove,
    change,
    keep,
  }
}

/**
 * Whether this panel would draw something different under the proposal.
 *
 * A null `visualizationId` beside a shape means the query has no visualization
 * of that shape yet, so there is nothing to compare and the answer is always
 * yes: one has to be created before the widget can point at it.
 */
function isRedrawn(widget: ExistingWidget, proposal: DashboardWidgetProposal): boolean {
  if (proposal.visualizationId == null) return proposal.vizChoiceId != null
  return proposal.visualizationId !== widget.visualizationId
}

export function isNoChange(edit: DashboardEdit): boolean {
  return edit.add.length === 0 && edit.remove.length === 0 && edit.change.length === 0
}

/**
 * What the card says it is about to do, so the user reads the change rather
 * than a widget list they have to diff by eye.
 */
export function editSummary(edit: DashboardEdit): string {
  if (isNoChange(edit)) return 'No change to this dashboard.'
  const parts: string[] = []
  if (edit.add.length > 0) {
    parts.push(`add ${edit.add.length} widget${edit.add.length === 1 ? '' : 's'}`)
  }
  if (edit.change.length > 0) {
    parts.push(`redraw ${edit.change.length} widget${edit.change.length === 1 ? '' : 's'}`)
  }
  if (edit.remove.length > 0) {
    parts.push(`remove ${edit.remove.length} widget${edit.remove.length === 1 ? '' : 's'}`)
  }
  // Sentence case, and the count of what survives, because "remove 3 widgets"
  // on its own does not say whether anything is left. A redrawn widget counts
  // as surviving: the panel is replaced, but the dashboard still shows it.
  const kept = edit.keep.length + edit.change.length
  // "a and b" for two, "a, b and c" for three. Joining all three with commas
  // reads as a truncated list rather than a finished sentence.
  const done =
    parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
  return `${done}, keeping ${kept} of the ${kept + edit.remove.length} already here.`.replace(
    /^./,
    (first) => first.toUpperCase()
  )
}

/**
 * What to say when part of an edit did not land.
 *
 * Not proposal-model's partialDashboardMessage, which says "the dashboard was
 * created": nothing was created here, and telling someone their dashboard was
 * created when they asked for a widget to be removed describes a different
 * event than the one that happened. Naming what failed is the point, so the
 * wording has to be about the change they actually asked for.
 */
export function partialEditMessage(failedTitles: string[]): string | null {
  if (failedTitles.length === 0) return null
  const noun = failedTitles.length === 1 ? 'widget' : 'widgets'
  return `The change was applied, except for ${failedTitles.length} ${noun}: ${failedTitles.join(', ')}. Try that part by hand.`
}
