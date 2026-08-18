// Turning a proposed widget list into a change to a dashboard that exists.
//
// The model is asked for the list the dashboard should END UP with, not for a
// set of operations, and the difference is computed here: the model writes
// words, this half assigns ids, so a hallucinated id can never delete a widget
// somebody else was using.

import type { DashboardWidgetProposal } from '@/types/ai-create'

export interface ExistingWidget {
  id: number
  queryId: number | null
  // What the panel points at today. A widget IS a visualization of a query, so
  // without this the difference below cannot see "draw this query as a bar chart
  // instead" and reports no change.
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
 * Matched on queryId, the only identity the two sides share. Two widgets over
 * the same query are treated as one match and the extra is left alone, since
 * nothing in the proposal distinguishes them.
 *
 * A widget with no query (a text box) is never in `remove`: the conversation is
 * grounded on query-backed widgets only, so the model was never told text boxes
 * exist.
 *
 * A proposed widget carrying a query still to be written has no id to compare,
 * so it is always an addition.
 *
 * A widget whose query stays but whose visualization does not is a `change`.
 * Redash cannot repoint a widget (its update endpoint writes `text` and
 * `options` only), so applying one is a delete followed by a create.
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

  // Exactly one current panel per query answers the proposal for that query; any
  // other panel over the same query is left exactly as it is. The panel that
  // ALREADY draws what was proposed wins, or a proposal matching one of two
  // panels would redraw the other one.
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
    // the proposal names it: the panel answering for it is above.
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
 * of that shape yet, so the answer is always yes: one has to be created first.
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
  // A redrawn widget counts as surviving: the panel is replaced, but the
  // dashboard still shows it.
  const kept = edit.keep.length + edit.change.length
  // "a and b" for two, "a, b and c" for three. All commas reads as a truncated
  // list rather than a finished sentence.
  const done =
    parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
  return `${done}, keeping ${kept} of the ${kept + edit.remove.length} already here.`.replace(
    /^./,
    (first) => first.toUpperCase()
  )
}

/**
 * What to say when part of an edit did not land. Not proposal-model's
 * partialDashboardMessage, which says "the dashboard was created": nothing was
 * created here.
 */
export function partialEditMessage(failedTitles: string[]): string | null {
  if (failedTitles.length === 0) return null
  const noun = failedTitles.length === 1 ? 'widget' : 'widgets'
  return `The change was applied, except for ${failedTitles.length} ${noun}: ${failedTitles.join(', ')}. Try that part by hand.`
}
