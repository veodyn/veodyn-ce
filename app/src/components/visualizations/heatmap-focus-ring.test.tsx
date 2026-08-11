import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { HeatmapRenderer } from './heatmap-renderer'

// Task 5 fix round 5. Hover and focus drove ONE piece of state, and the focus
// ring was painted from it, so any pointer activity anywhere in the grid took
// the focus indicator off a cell that still held DOM focus: hovering another
// cell stole the state, and the pointer leaving a cell cleared it outright.
// Neither involves a focus change, so this is a WCAG 2.4.7 failure reachable
// without the user ever touching the keyboard again, and reachable without
// the user moving the mouse at all, since scrolling content under a
// stationary pointer makes the browser re-run its hit test and fire
// mouseover/mouseout of its own accord.
//
// Split into its own file rather than added to
// heatmap-renderer-interaction.test.tsx, which is already at the file-size
// hook's limit; the seam is real (the focus INDICATOR against pointer state,
// not the hover/focus tooltip wiring that file covers).

const visualization: MockVisualization = {
  id: 1,
  type: 'HEATMAP',
  name: 'Test heatmap',
  description: '',
  options: { columnMapping: { weekday: 'x', period: 'y', count: 'value' } },
  created_at: '2026-07-21T00:00:00Z',
  updated_at: '2026-07-21T00:00:00Z',
}

const data: QueryResultData = {
  columns: [
    { name: 'weekday', friendly_name: 'Weekday', type: 'string' },
    { name: 'period', friendly_name: 'Period', type: 'string' },
    { name: 'count', friendly_name: 'Count', type: 'integer' },
  ],
  rows: [
    { weekday: 'Monday', period: 'Morning', count: 12 },
    { weekday: 'Tuesday', period: 'Evening', count: 34 },
  ],
}

// ring-2 is the heavy ring the grid paints on the cell being read, and the
// only visible focus indicator outside forced-colors mode. ring-1 (the
// row/column band) is deliberately not accepted here: a cell sharing a row
// with whatever the pointer is on is not a focus indicator.
const HEAVY_RING = /\bring-2\b/

// jsdom runs no layout, so every getBoundingClientRect is a zero rect and two
// cells' tooltips land at identical coordinates whatever the code does. Giving
// the two cells under test their own rects is what lets the tooltip's own
// `left` say WHICH cell it is anchored to, which is the difference between
// restoring the focused cell and restoring it without moving the tooltip back
// off the cell the pointer just left.
function stubCellRect(el: HTMLElement, left: number, top: number) {
  const rect = {
    left,
    top,
    right: left + 40,
    bottom: top + 20,
    width: 40,
    height: 20,
    x: left,
    y: top,
    toJSON: () => ({}),
  }
  el.getBoundingClientRect = () => rect as DOMRect
}

describe('HeatmapRenderer focus ring against pointer state', () => {
  it('keeps the focus ring when the pointer leaves the focused cell', async () => {
    const user = userEvent.setup()
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    const focused = screen.getByLabelText('Monday / Morning: 12')
    await user.tab()
    expect(focused).toHaveFocus()

    await user.hover(focused)
    await user.unhover(focused)

    expect(focused).toHaveFocus()
    expect(focused.className).toMatch(HEAVY_RING)
    // The tooltip goes with it: the pointer drifting off a cell that still
    // holds focus has not stopped that cell from being the one being read.
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Monday / Morning: 12')
  })

  it('keeps the focus ring on the focused cell while the pointer is on a different one', async () => {
    const user = userEvent.setup()
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    const focused = screen.getByLabelText('Monday / Morning: 12')
    // Shares neither its row nor its column with the focused cell, so the
    // row/column band cannot be what keeps a ring on it.
    const elsewhere = screen.getByLabelText('Tuesday / Evening: 34')
    await user.tab()
    expect(focused).toHaveFocus()

    await user.hover(elsewhere)

    expect(focused).toHaveFocus()
    expect(focused.className).toMatch(HEAVY_RING)
    // The pointer still owns the tooltip and the band: this is about the
    // focus indicator surviving alongside them, not about taking them over.
    expect(elsewhere.className).toMatch(HEAVY_RING)
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Tuesday / Evening: 34')

    // Leaving that other cell hands the reading back to the cell that still
    // holds focus. This test used to stop at the hover above and never leave,
    // which is why it could not see that the departure cleared the active
    // cell outright: the focused cell kept its ring but lost its tooltip and
    // its row/column band, with no focus change to justify either, and stayed
    // that way until the user did something else.
    await user.unhover(elsewhere)

    expect(focused).toHaveFocus()
    expect(focused.className).toMatch(HEAVY_RING)
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Monday / Morning: 12')
    // The band follows it back too: the column header over the focused cell
    // is the one emphasised, not the one over the cell the pointer left.
    expect(screen.getByRole('columnheader', { name: 'Monday' }).className).toMatch(/\bfont-semibold\b/)
    expect(screen.getByRole('columnheader', { name: 'Tuesday' }).className).not.toMatch(/\bfont-semibold\b/)
  })

  it('re-anchors the tooltip onto the focused cell when the pointer leaves another one', async () => {
    // Restoring the active cell without re-positioning would leave the
    // tooltip drawing the focused cell's text at the departed cell's
    // coordinates, which is a worse lie than closing it: it names one cell
    // while pointing at another.
    const user = userEvent.setup()
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    const focused = screen.getByLabelText('Monday / Morning: 12')
    const elsewhere = screen.getByLabelText('Tuesday / Evening: 34')
    stubCellRect(focused, 200, 300)
    stubCellRect(elsewhere, 600, 300)

    await user.tab()
    expect(focused).toHaveFocus()
    // Centered on the cell: 200 + 40 / 2, inside the viewport clamp.
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveStyle({ left: '220px' })

    await user.hover(elsewhere)
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveStyle({ left: '620px' })

    await user.unhover(elsewhere)
    const tooltip = screen.getByRole('tooltip', { hidden: true })
    expect(tooltip).toHaveTextContent('Monday / Morning: 12')
    expect(tooltip).toHaveStyle({ left: '220px' })
  })

  it('drops the focus ring once focus genuinely leaves the cell', async () => {
    // The other half of the invariant: the ring has to be a focus indicator,
    // not a permanent mark on whichever cell was focused first. An
    // implementation that simply never cleared focusedCell would pass both
    // tests above and fail this one.
    const user = userEvent.setup()
    render(
      <>
        <button>after</button>
        <HeatmapRenderer visualization={visualization} data={data} />
      </>
    )

    const focused = screen.getByLabelText('Monday / Morning: 12')
    await user.tab()
    await user.tab()
    expect(focused).toHaveFocus()

    await user.tab()
    expect(focused).not.toHaveFocus()
    expect(focused.className).not.toMatch(HEAVY_RING)
  })
})
