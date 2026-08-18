import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { HeatmapRenderer } from './heatmap-renderer'

// Hover, focus and tooltip wiring for the heatmap grid: reaching a cell's value
// without a mouse.
//
// The grid roves tabIndex (exactly one cell is ever a Tab stop, arrow keys move
// it), because tabIndex={0} on every cell costs a keyboard user one Tab press
// per cell. Whether the computed accessible name is right cannot be proven
// here: dom-accessibility-api, behind jest-dom's toHaveAccessibleName under
// jsdom, does not implement the "name from: prohibited" rule role="generic"
// carries, so it reports a name for a bare aria-label div whatever its role.
// Only e2e/heatmap-interaction.spec.ts can catch that.

const visualization: MockVisualization = {
  id: 1,
  type: 'HEATMAP',
  name: 'Test heatmap',
  description: '',
  options: {
    columnMapping: {
      weekday: 'x',
      period: 'y',
      count: 'value',
    },
  },
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

describe('HeatmapRenderer cell reachability and the tooltip', () => {
  it('gives a data-bearing cell an accessible name carrying row, column, and the EXACT value, not the compact form', () => {
    // count: 1_500 prints as "1.5K" under formatCompactNumber. A dense grid
    // hides the printed number, so the accessible name (and the tooltip built
    // from the same description) is the only place the exact value survives.
    const bigViz: MockVisualization = { ...visualization, options: { ...visualization.options, showValues: 'always' } }
    const bigData: QueryResultData = {
      columns: data.columns,
      rows: [{ weekday: 'Monday', period: 'Morning', count: 1_500 }],
    }
    render(<HeatmapRenderer visualization={bigViz} data={bigData} />)

    const cell = screen.getByLabelText('Monday / Morning: 1500')
    expect(cell).toHaveTextContent('1.5K')
  })

  it('bounds an average to 2 decimal places instead of printing raw floating-point division', () => {
    // 10 + 20 + 25, divided by 3, is 18.333333333333332 in IEEE 754. The
    // rounded cell text was never at risk of that, the exact-value description
    // (accessible name and tooltip) was.
    const avgViz: MockVisualization = {
      ...visualization,
      options: { ...visualization.options, aggregation: 'avg' },
    }
    const avgData: QueryResultData = {
      columns: data.columns,
      rows: [
        { weekday: 'Monday', period: 'Morning', count: 10 },
        { weekday: 'Monday', period: 'Morning', count: 20 },
        { weekday: 'Monday', period: 'Morning', count: 25 },
      ],
    }
    render(<HeatmapRenderer visualization={avgViz} data={avgData} />)

    expect(screen.getByLabelText('Monday / Morning: 18.33')).toBeInTheDocument()
    expect(screen.queryByLabelText(/18\.333333/)).not.toBeInTheDocument()
  })

  it('gives an empty cell an accessible name too', () => {
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    // weekday x period only has 2 of the 4 possible combinations populated;
    // Monday/Evening is one of the two empty ones.
    expect(screen.getByLabelText('Monday / Evening: no data')).toBeInTheDocument()
  })

  it('gives every cell role="gridcell", the role an aria-label can actually name', () => {
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    expect(screen.getByLabelText('Monday / Morning: 12')).toHaveAttribute('role', 'gridcell')
    expect(screen.getByLabelText('Monday / Evening: no data')).toHaveAttribute('role', 'gridcell')
  })

  it('roves tabIndex: exactly one cell is a Tab stop, defaulting to the first cell in the grid', () => {
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    const tabbable = screen.getAllByRole('gridcell').filter((el) => el.getAttribute('tabindex') === '0')
    expect(tabbable).toHaveLength(1)
    expect(tabbable[0]).toHaveAccessibleName('Monday / Morning: 12')
  })

  it('moves the roving tabIndex with the arrow keys, keeping the invariant of exactly one tabIndex=0 cell', async () => {
    const user = userEvent.setup()
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    await user.tab()
    expect(screen.getByLabelText('Monday / Morning: 12')).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(screen.getByLabelText('Tuesday / Morning: no data')).toHaveFocus()
    expect(screen.getByLabelText('Tuesday / Morning: no data')).toHaveAttribute('tabIndex', '0')
    expect(screen.getByLabelText('Monday / Morning: 12')).toHaveAttribute('tabIndex', '-1')

    await user.keyboard('{ArrowDown}')
    expect(screen.getByLabelText('Tuesday / Evening: 34')).toHaveFocus()

    let tabbable = screen.getAllByRole('gridcell').filter((el) => el.getAttribute('tabindex') === '0')
    expect(tabbable).toHaveLength(1)
    expect(tabbable[0]).toBe(screen.getByLabelText('Tuesday / Evening: 34'))

    // ArrowRight/ArrowDown clamp at the last row/column rather than wrapping.
    // Tuesday and Evening are the last categories here, so both are no-ops.
    await user.keyboard('{ArrowRight}{ArrowDown}')
    expect(screen.getByLabelText('Tuesday / Evening: 34')).toHaveFocus()
    tabbable = screen.getAllByRole('gridcell').filter((el) => el.getAttribute('tabindex') === '0')
    expect(tabbable).toHaveLength(1)
  })

  it('moves ArrowLeft and ArrowUp too, not just ArrowRight/ArrowDown', async () => {
    // Proves ArrowLeft/ArrowUp really move focus (the walk-back below) and that
    // the grid tolerates being pushed past its own edge. It does NOT prove the
    // min-edge clamp is present: at index 0 a working clamp and a dropped one
    // look identical in the DOM, since xCategories[-1] is undefined and
    // focusCellAt's optional chaining no-ops on it. The clamp is asserted
    // directly in use-heatmap-grid-interaction.test.ts's nextRovingIndices tests.
    const user = userEvent.setup()
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    await user.tab()
    expect(screen.getByLabelText('Monday / Morning: 12')).toHaveFocus()

    // Already at the first column and row: ArrowLeft/ArrowUp here must not move
    // focus somewhere invalid or throw.
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByLabelText('Monday / Morning: 12')).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByLabelText('Monday / Morning: 12')).toHaveFocus()

    // Move right and down first, then walk back with ArrowLeft/ArrowUp to
    // prove those two keys actually move focus, not just fail to move it.
    await user.keyboard('{ArrowRight}{ArrowDown}')
    expect(screen.getByLabelText('Tuesday / Evening: 34')).toHaveFocus()

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByLabelText('Monday / Evening: no data')).toHaveFocus()
    expect(screen.getByLabelText('Monday / Evening: no data')).toHaveAttribute('tabIndex', '0')
    expect(screen.getByLabelText('Tuesday / Evening: 34')).toHaveAttribute('tabIndex', '-1')

    await user.keyboard('{ArrowUp}')
    expect(screen.getByLabelText('Monday / Morning: 12')).toHaveFocus()

    const tabbable = screen.getAllByRole('gridcell').filter((el) => el.getAttribute('tabindex') === '0')
    expect(tabbable).toHaveLength(1)
    expect(tabbable[0]).toBe(screen.getByLabelText('Monday / Morning: 12'))
  })

  it('shows no tooltip for any cell before it is hovered or focused', () => {
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument()
  })

  it('opens the tooltip on keyboard focus, follows the roving tabIndex on arrow-key movement, and closes once focus leaves the grid', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button>before</button>
        <HeatmapRenderer visualization={visualization} data={data} />
      </>,
    )

    const before = screen.getByText('before')
    before.focus()
    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument()

    // Only one cell (the roving stop) is reachable by Tab at all.
    await user.tab()
    expect(screen.getByLabelText('Monday / Morning: 12')).toHaveFocus()
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Monday / Morning: 12')

    await user.keyboard('{ArrowRight}')
    expect(screen.getByLabelText('Tuesday / Morning: no data')).toHaveFocus()
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Tuesday / Morning: no data')

    await user.tab()
    expect(screen.getByLabelText('Tuesday / Morning: no data')).not.toHaveFocus()
    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument()
  })

  it('opens the tooltip on hover and closes it again on unhover', async () => {
    const user = userEvent.setup()
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    const cell = screen.getByLabelText('Tuesday / Evening: 34')
    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument()

    await user.hover(cell)
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Tuesday / Evening: 34')

    await user.unhover(cell)
    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument()
  })

  it('marks the floating tooltip aria-hidden, since the cell already carries the same text as its accessible name', async () => {
    const user = userEvent.setup()
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    await user.hover(screen.getByLabelText('Monday / Morning: 12'))
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveAttribute('aria-hidden', 'true')
  })

  it('rings the hovered cell itself, and every other cell sharing its row or column, but not a cell sharing neither', async () => {
    const user = userEvent.setup()
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    // Monday/Morning and Tuesday/Evening share neither weekday nor period, so
    // hovering one must not ring the other. A fixture where every pair shared a
    // row or column would pass with no row/column comparison implemented.
    const hovered = screen.getByLabelText('Monday / Morning: 12')
    const sameRow = screen.getByLabelText('Tuesday / Morning: no data')
    const unrelated = screen.getByLabelText('Tuesday / Evening: 34')

    expect(hovered.className).not.toMatch(/\bring-/)
    expect(sameRow.className).not.toMatch(/\bring-/)

    await user.hover(hovered)

    expect(hovered.className).toMatch(/ring-2/)
    expect(sameRow.className).toMatch(/ring-1/)
    expect(unrelated.className).not.toMatch(/\bring-/)

    await user.unhover(hovered)

    expect(hovered.className).not.toMatch(/\bring-/)
    expect(sameRow.className).not.toMatch(/\bring-/)
  })
})
