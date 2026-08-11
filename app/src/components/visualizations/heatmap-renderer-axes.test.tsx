import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { HeatmapRenderer } from './heatmap-renderer'

// Task 6: the two things the renderer itself has to get right about the axes,
// as opposed to the model. Stickiness is deliberately NOT here: jsdom
// implements no layout at all, so nothing in this environment can tell a
// header that sticks from one that merely carries the class. That is
// e2e/heatmap-sticky-headers.spec.ts's job, measured against a real browser.

const visualization: MockVisualization = {
  id: 1,
  type: 'HEATMAP',
  name: 'Test heatmap',
  description: '',
  options: { columnMapping: { quarter: 'x', team: 'y', deals: 'value' } },
  created_at: '2026-07-21T00:00:00Z',
  updated_at: '2026-07-21T00:00:00Z',
}

const columns: QueryResultData['columns'] = [
  { name: 'quarter', friendly_name: 'Fiscal Quarter', type: 'string' },
  { name: 'team', friendly_name: 'Sales Team', type: 'string' },
  { name: 'deals', friendly_name: 'Deals Closed', type: 'integer' },
]

// The same three-way fixture heatmap-model-sort.test.ts uses, cut down to two
// quarters: Steady wins on total, Spike wins on peak, and neither is first in
// appearance order.
const data: QueryResultData = {
  columns,
  rows: [
    { quarter: 'Q1', team: 'Middle', deals: 12 },
    { quarter: 'Q1', team: 'Spike', deals: 30 },
    { quarter: 'Q1', team: 'Steady', deals: 20 },
    { quarter: 'Q2', team: 'Middle', deals: 12 },
    { quarter: 'Q2', team: 'Spike', deals: 1 },
    { quarter: 'Q2', team: 'Steady', deals: 20 },
  ],
}

// Reads the y-axis labels straight off the rendered grid, in DOM order, which
// is the order a reader sees. Going through the model instead would test the
// model twice and the renderer not at all.
function renderedRowOrder(): string[] {
  const grid = screen.getByRole('grid')
  return within(grid)
    .getAllByRole('rowheader')
    .map((el) => el.textContent ?? '')
}

describe('HeatmapRenderer axis titles', () => {
  it('names the x and y columns beside the grid, by their friendly names', () => {
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    expect(screen.getByText('Fiscal Quarter')).toBeInTheDocument()
    expect(screen.getByText('Sales Team')).toBeInTheDocument()
  })

  it('falls back to the raw column name when the result set gives no friendly name', () => {
    // A real Redash result can carry an empty friendly_name; the axis still
    // has to say something, and the column's own name is the only thing left.
    // What this does NOT catch, measured: a middle `?? column.name` term in
    // the resolution. The column is found by matching that same name, so such
    // a term can never differ from the fallback, and dropping it changed no
    // test. It was removed from heatmap-model.ts rather than left in as
    // unreachable code no test could hold to account.
    const bare: QueryResultData = {
      columns: columns.map((c) => ({ ...c, friendly_name: '' })),
      rows: data.rows,
    }
    render(<HeatmapRenderer visualization={visualization} data={bare} />)

    expect(screen.getByText('quarter')).toBeInTheDocument()
    expect(screen.getByText('team')).toBeInTheDocument()
  })

  it('carries both axis names in the grid own accessible name', () => {
    // A reader entering the grid with a screen reader hears its label once,
    // before any cell. "Deals Closed heatmap" alone never says what the rows
    // and columns are.
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    expect(screen.getByRole('grid')).toHaveAccessibleName('Deals Closed heatmap, Fiscal Quarter by Sales Team')
  })
})

describe('HeatmapRenderer row order', () => {
  it('renders rows in first-appearance order by default', () => {
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    expect(renderedRowOrder()).toEqual(['Middle', 'Spike', 'Steady'])
  })

  it('renders rows in the model total order when the option asks for it', () => {
    // Steady 40, Spike 31, Middle 24, against a first-appearance order of
    // Middle, Spike, Steady. Two of the three move: Middle and Steady swap
    // ends. Spike happens to sit at index 1 in BOTH orders, so this ordering on
    // its own does not discriminate an implementation that only moved Spike;
    // the peak test below does, since all three move there.
    render(
      <HeatmapRenderer
        visualization={{ ...visualization, options: { ...visualization.options, sortRows: 'total' } }}
        data={data}
      />
    )

    expect(renderedRowOrder()).toEqual(['Steady', 'Spike', 'Middle'])
  })

  it('renders rows in the model peak order when the option asks for it, which is a different order again', () => {
    render(
      <HeatmapRenderer
        visualization={{ ...visualization, options: { ...visualization.options, sortRows: 'peak' } }}
        data={data}
      />
    )

    expect(renderedRowOrder()).toEqual(['Spike', 'Steady', 'Middle'])
  })

  it('keeps each row cells with their own row after a sort', () => {
    // The failure a row-order test alone cannot see: reordering the LABELS
    // while leaving the cells where they were would still produce the
    // expected label order above, and would put every value in the wrong row.
    render(
      <HeatmapRenderer
        visualization={{ ...visualization, options: { ...visualization.options, sortRows: 'peak' } }}
        data={data}
      />
    )

    const spikeRow = screen.getByRole('rowheader', { name: 'Spike' }).closest('[role="row"]')
    expect(spikeRow).not.toBeNull()
    expect(within(spikeRow as HTMLElement).getByLabelText('Q1 / Spike: 30')).toBeInTheDocument()
    expect(within(spikeRow as HTMLElement).getByLabelText('Q2 / Spike: 1')).toBeInTheDocument()
  })
})
