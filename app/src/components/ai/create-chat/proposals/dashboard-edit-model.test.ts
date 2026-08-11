import { describe, expect, it } from 'vitest'
import type { DashboardWidgetProposal } from '@/types/ai-create'
import { dashboardEdit, editSummary, isNoChange, type ExistingWidget } from './dashboard-edit-model'

// The visualization ids line up with `proposed` below on purpose: a widget over
// query 11 already drawing visualization 911 is what "the proposal asks for what
// is already there" means now that a widget is a query AND a shape.
function existing(id: number, queryId: number | null, title = `w${id}`): ExistingWidget {
  return { id, queryId, visualizationId: queryId == null ? null : 900 + queryId, title }
}

function proposed(queryId: number, title = `q${queryId}`): DashboardWidgetProposal {
  return { title, queryId, visualizationId: 900 + queryId, vizChoiceId: 'table', newQuery: null }
}

/** The same query, drawn as something it is not drawn as today. */
function redrawn(queryId: number, visualizationId: number | null, vizChoiceId = 'chart-bar') {
  return { title: `q${queryId}`, queryId, visualizationId, vizChoiceId, newQuery: null }
}

/** A panel whose query does not exist yet, so it has no id to compare. */
function written(title: string): DashboardWidgetProposal {
  return {
    title,
    queryId: null,
    visualizationId: null,
    vizChoiceId: null,
    newQuery: {
      name: title,
      description: '',
      sql: 'SELECT 1',
      datasetTable: 'events',
      vizChoiceId: 'table',
      vizOptions: {},
    },
  }
}

describe('dashboardEdit', () => {
  it('adds a widget the dashboard does not have', () => {
    const edit = dashboardEdit([existing(1, 11)], [proposed(11), proposed(12)])

    expect(edit.add.map((w) => w.queryId)).toEqual([12])
    expect(edit.remove).toEqual([])
    expect(edit.keep.map((w) => w.id)).toEqual([1])
  })

  it('removes a widget the proposal leaves out', () => {
    const edit = dashboardEdit([existing(1, 11), existing(2, 12)], [proposed(11)])

    expect(edit.add).toEqual([])
    expect(edit.remove.map((w) => w.id)).toEqual([2])
  })

  it('does both at once', () => {
    const edit = dashboardEdit([existing(1, 11), existing(2, 12)], [proposed(11), proposed(13)])

    expect(edit.add.map((w) => w.queryId)).toEqual([13])
    expect(edit.remove.map((w) => w.id)).toEqual([2])
  })

  it('never removes a text box', () => {
    // A text box has no query, so the conversation was never told it exists.
    // Its absence from the proposal is silence, not a request to delete it,
    // and the difference matters: one is a widget somebody wrote by hand.
    const edit = dashboardEdit([existing(1, null, 'notes'), existing(2, 12)], [proposed(12)])

    expect(edit.remove).toEqual([])
    expect(edit.keep.map((w) => w.id)).toEqual([1, 2])
  })

  it('leaves a duplicate over the same query alone rather than guessing', () => {
    // Two widgets charting one query, and a proposal that names it once.
    // Nothing in the proposal says which of the two it means, and removing
    // the wrong one is worse than leaving a duplicate standing.
    const edit = dashboardEdit([existing(1, 11), existing(2, 11)], [proposed(11)])

    expect(edit.remove).toEqual([])
    expect(edit.keep.map((w) => w.id)).toEqual([1, 2])
  })

  it('adds a query only once even when the proposal repeats it', () => {
    const edit = dashboardEdit([], [proposed(11), proposed(11)])

    // Both are additions, because neither is on the dashboard yet: the model
    // asking for the same chart twice is a request, not a collision.
    expect(edit.add).toHaveLength(2)
  })

  it('proposes nothing to do when the list already matches', () => {
    const edit = dashboardEdit([existing(1, 11)], [proposed(11)])

    expect(isNoChange(edit)).toBe(true)
  })

  it('reads an empty proposal against an empty dashboard as no change', () => {
    expect(isNoChange(dashboardEdit([], []))).toBe(true)
  })

  it('sees a widget kept over the same query but drawn differently', () => {
    // The defect this bucket exists for. Every query stays, so matching on
    // queryId alone reported "No change to this dashboard" for a proposal that
    // turned six tables into charts.
    const edit = dashboardEdit([existing(1, 11)], [redrawn(11, 950)])

    expect(isNoChange(edit)).toBe(false)
    expect(edit.change.map((c) => c.widget.id)).toEqual([1])
    expect(edit.change.map((c) => c.proposal.visualizationId)).toEqual([950])
    // Not a remove and an add: Redash cannot repoint a widget, so this is one
    // panel replaced, and counting it as a removal would say the dashboard is
    // losing something.
    expect(edit.remove).toEqual([])
    expect(edit.add).toEqual([])
  })

  it('treats a shape the query does not have yet as a change', () => {
    // A null id beside a shape means "create this visualization first". There
    // is no id to compare, and the answer cannot be "no change".
    const edit = dashboardEdit([existing(1, 11)], [redrawn(11, null)])

    expect(edit.change.map((c) => c.proposal.vizChoiceId)).toEqual(['chart-bar'])
    expect(isNoChange(edit)).toBe(false)
  })

  it('keeps a widget the proposal repeats without naming a shape', () => {
    // vizChoiceId null and visualizationId matching is the shape an unchanged
    // widget of an edit arrives in. It must not read as a redraw, or every edit
    // would rebuild every panel it touched.
    const edit = dashboardEdit([existing(1, 11)], [{ ...proposed(11), vizChoiceId: null }])

    expect(isNoChange(edit)).toBe(true)
    expect(edit.change).toEqual([])
  })

  it('leaves a duplicate alone when its twin already draws what was proposed', () => {
    // Two panels on query 11: one showing 911, one showing 950. The proposal
    // asks for 950, which one of them already is. Taking the FIRST panel as the
    // match would redraw 911 into a second copy of 950, changing a panel
    // nothing in the proposal named.
    const shown950 = { ...existing(2, 11), visualizationId: 950 }
    const edit = dashboardEdit([existing(1, 11), shown950], [redrawn(11, 950)])

    expect(edit.change).toEqual([])
    expect(edit.keep.map((w) => w.id)).toEqual([1, 2])
    expect(isNoChange(edit)).toBe(true)
  })

  it('does not add a second panel for a query the dashboard already charts', () => {
    // The proposal naming query 11 twice is one match and one repeat, the same
    // rule the removals follow. Adding the repeat would grow the dashboard by a
    // panel on every apply.
    const edit = dashboardEdit([existing(1, 11)], [proposed(11), proposed(11)])

    expect(edit.add).toEqual([])
    expect(isNoChange(edit)).toBe(true)
  })

  it('redraws only the first of two panels over one query', () => {
    // Same reason removals leave duplicates alone: nothing in the proposal says
    // which of the two it meant, and rebuilding both is a change nobody asked
    // for on the panel that was not named.
    const edit = dashboardEdit([existing(1, 11), existing(2, 11)], [redrawn(11, 950)])

    expect(edit.change.map((c) => c.widget.id)).toEqual([1])
    expect(edit.keep.map((w) => w.id)).toEqual([2])
  })

  it('does not treat a proposal that clears the dashboard as no change', () => {
    expect(isNoChange(dashboardEdit([existing(1, 11)], []))).toBe(false)
  })
})

describe('editSummary', () => {
  it('says so plainly when there is nothing to do', () => {
    expect(editSummary(dashboardEdit([existing(1, 11)], [proposed(11)]))).toMatch(/no change/i)
  })

  it('counts what it adds', () => {
    const summary = editSummary(dashboardEdit([existing(1, 11)], [proposed(11), proposed(12)]))

    expect(summary).toContain('Add 1 widget')
    expect(summary).not.toContain('1 widgets')
  })

  it('counts what it removes and what survives', () => {
    // "Remove 2 widgets" alone does not say whether anything is left, which is
    // the one thing a reader about to press the button wants to know.
    const summary = editSummary(
      dashboardEdit([existing(1, 11), existing(2, 12), existing(3, 13)], [proposed(11)])
    )

    expect(summary).toContain('Remove 2 widgets')
    expect(summary).toContain('keeping 1 of the 3')
  })

  it('reads as one sentence when it does both', () => {
    const summary = editSummary(dashboardEdit([existing(1, 11), existing(2, 12)], [proposed(11), proposed(13)]))

    expect(summary).toContain('Add 1 widget and remove 1 widget')
  })

  it('counts a redrawn widget as one that survives, not one that goes', () => {
    const summary = editSummary(dashboardEdit([existing(1, 11), existing(2, 12)], [redrawn(11, 950)]))

    expect(summary).toContain('Redraw 1 widget and remove 1 widget')
    expect(summary).toContain('keeping 1 of the 2')
  })

  it('joins three kinds of change with commas and a final and', () => {
    const summary = editSummary(
      dashboardEdit([existing(1, 11), existing(2, 12)], [redrawn(11, 950), proposed(13)])
    )

    expect(summary).toContain('Add 1 widget, redraw 1 widget and remove 1 widget')
  })
})

describe('dashboardEdit with a panel to be written', () => {
  it('always adds it, since there is nothing on the dashboard it could be', () => {
    const edit = dashboardEdit([existing(1, 11)], [proposed(11), written('New angle')])

    expect(edit.add.map((w) => w.title)).toEqual(['New angle'])
    expect(edit.remove).toEqual([])
  })

  it('does not let it keep an unrelated panel alive', () => {
    // A widget with no queryId matches no existing panel, so the panel the
    // proposal left out is still removed rather than being read as kept.
    const edit = dashboardEdit([existing(1, 11), existing(2, 12)], [proposed(11), written('New angle')])

    expect(edit.remove.map((w) => w.id)).toEqual([2])
  })
})
