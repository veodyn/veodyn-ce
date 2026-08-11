import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { HeatmapRenderer } from './heatmap-renderer'

// Task 5 fix round 2, important finding 1: role="grid" requires its owned
// children to be row (or rowgroup), and role="row" requires its owned
// children to be gridcell/columnheader/rowheader. The first round's fix
// added role="grid" and role="gridcell" but stopped one level short: the
// column-header band was never wrapped in its own role="row", the column
// headers carried no role at all, and the y-axis labels were plain,
// role-less divs where the ARIA grid pattern calls for role="rowheader".
// Nothing in the suite asserted role="row" at all, so none of that gap was
// caught. This file tests the STRUCTURE (row/columnheader/rowheader counts),
// not just that a value-bearing cell can be found by its label, which is
// heatmap-renderer-interaction.test.tsx's concern instead.

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

describe('HeatmapRenderer grid structure', () => {
  it('owns one row per y category plus one header row, all with role="row"', () => {
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    const grid = screen.getByRole('grid')
    // 2 distinct periods (Morning, Evening) plus the column-header band.
    expect(within(grid).getAllByRole('row')).toHaveLength(3)
  })

  it('has ONLY role="row" elements as the direct children of role="grid"', () => {
    // within(grid).getAllByRole('row') above counts DESCENDANTS, so it never
    // asserts the grid's OWN children are only rows: a bare, role-less
    // <div/> re-added as a direct child of the grid (the exact original
    // defect this whole file exists to catch) still passes that count,
    // since the bug does not remove or duplicate any row, it just adds an
    // extra, unrelated child alongside them. Checking element.children
    // directly is the only way to see that.
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    const grid = screen.getByRole('grid')
    const directChildren = Array.from(grid.children)
    expect(directChildren.length).toBeGreaterThan(0)
    for (const child of directChildren) {
      expect(child).toHaveAttribute('role', 'row')
    }
  })

  it('has ONLY gridcell/columnheader/rowheader elements as the direct children of each row', () => {
    // The mirror of the grid-children test above, one level down, and now the
    // likelier regression of the two: the header band is itself a role="row",
    // so a bare <div/> re-added inside a row (a spacer, a wrapper around the
    // labels) is invalid ARIA in exactly the way the original defect was. The
    // count-based tests below cannot see it: getAllByRole('gridcell') and
    // friends count what IS there, never what else is.
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    const grid = screen.getByRole('grid')
    const rows = within(grid).getAllByRole('row')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const children = Array.from(row.children)
      expect(children.length).toBeGreaterThan(0)
      for (const child of children) {
        expect(['gridcell', 'columnheader', 'rowheader']).toContain(child.getAttribute('role'))
      }
    }
  })

  it('never nests one role="row" inside another', () => {
    // The count-based tests above locate "the row" via
    // element.closest('[role="row"]'), which finds the NEAREST ancestor row
    // regardless of whether a second, outer role="row" also wraps it; a
    // future regression that wrapped a row in another row-role element could
    // still report plausible counts from those tests alone. Asserting no
    // row contains another row directly rules that shape out.
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    const grid = screen.getByRole('grid')
    const rows = within(grid).getAllByRole('row')
    for (const row of rows) {
      expect(within(row).queryAllByRole('row')).toHaveLength(0)
    }
  })

  it('gives the header row one columnheader per x category, plus the blank corner cell', () => {
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    const headerRow = screen.getByRole('columnheader', { name: 'Monday' }).closest('[role="row"]')
    expect(headerRow).not.toBeNull()
    // The blank corner cell (no accessible name) plus Monday and Tuesday.
    expect(within(headerRow as HTMLElement).getAllByRole('columnheader')).toHaveLength(3)
  })

  it('gives each data row exactly one rowheader (its y-category label) plus one gridcell per x category', () => {
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    const morningRow = screen.getByRole('rowheader', { name: 'Morning' }).closest('[role="row"]')
    expect(morningRow).not.toBeNull()
    expect(within(morningRow as HTMLElement).getAllByRole('rowheader')).toHaveLength(1)
    expect(within(morningRow as HTMLElement).getAllByRole('gridcell')).toHaveLength(2)

    const eveningRow = screen.getByRole('rowheader', { name: 'Evening' }).closest('[role="row"]')
    expect(eveningRow).not.toBeNull()
    expect(within(eveningRow as HTMLElement).getAllByRole('rowheader')).toHaveLength(1)
    expect(within(eveningRow as HTMLElement).getAllByRole('gridcell')).toHaveLength(2)
  })

  it('names the y-axis label a rowheader, not a plain unlabelled div', () => {
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    expect(screen.getByRole('rowheader', { name: 'Morning' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'Evening' })).toBeInTheDocument()
  })
})
