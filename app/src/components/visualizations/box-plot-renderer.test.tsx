import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { BoxPlotRenderer } from './box-plot-renderer'

const visualization: MockVisualization = {
  id: 1,
  type: 'BOXPLOT',
  name: 'Test box plot',
  description: '',
  options: {},
  created_at: '2026-07-21T00:00:00Z',
  updated_at: '2026-07-21T00:00:00Z',
}

const columns: QueryResultData['columns'] = [
  { name: 'grp', friendly_name: 'Group', type: 'string' },
  { name: 'v', friendly_name: 'Value', type: 'integer' },
]

const data: QueryResultData = {
  columns,
  rows: [
    { grp: 'A', v: 1 },
    { grp: 'A', v: 3 },
    { grp: 'A', v: 5 },
    { grp: 'B', v: 2 },
    { grp: 'B', v: 8 },
  ],
}

// Three categories, all far from zero: the demo fixture's shape (corridor
// travel times of 22 to 93 minutes) reduced to the smallest case that shows
// both the alignment and the axis-domain behaviour.
function farFromZero(): QueryResultData {
  return {
    columns,
    rows: ['A', 'B', 'C'].flatMap((grp, i) => [100, 110, 120, 130, 140].map((v) => ({ grp, v: v + i }))),
  }
}

describe('BoxPlotRenderer', () => {
  it('renders a column per category', () => {
    render(<BoxPlotRenderer visualization={visualization} data={data} />)

    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  it('shows the empty state without a numeric value column', () => {
    const dataWithoutNumericValue: QueryResultData = {
      columns: [{ name: 'grp', friendly_name: 'Group', type: 'string' }],
      rows: [{ grp: 'A' }],
    }

    render(
      <BoxPlotRenderer
        visualization={visualization}
        data={dataWithoutNumericValue}
      />,
    )

    expect(
      screen.getByText(
        'Box plot requires a category and a numeric value column.',
      ),
    ).toBeInTheDocument()
  })

  // jsdom does no layout, so asserting a pixel position here would prove
  // nothing: every element measures 0x0. The honest assertion is structural.
  // A label drifted off its box because the boxes and the labels were two
  // separately sized rows (flex with a gap over flex without one), so what has
  // to hold is that they are ONE row of cells: a category's marks and its
  // label share a cell, which no spacing change can pull apart.
  it('keeps a category label in the same cell as the box it names', () => {
    render(<BoxPlotRenderer visualization={visualization} data={farFromZero()} />)

    const column = screen.getByRole('img', { name: /^B:/ })
    const cell = column.parentElement
    expect(cell).not.toBeNull()
    expect(cell).toHaveTextContent('B')
    expect(cell).not.toHaveTextContent('A')
  })

  it('lays the columns out as one cell per category, not a row of boxes over a row of labels', () => {
    render(<BoxPlotRenderer visualization={visualization} data={farFromZero()} />)

    const cell = screen.getByRole('img', { name: /^B:/ }).parentElement
    const row = cell?.parentElement
    // Three categories, three cells. A separate label row would make this 2:
    // one container of boxes plus one container of labels.
    expect(row?.children).toHaveLength(3)
    for (const child of Array.from(row?.children ?? [])) {
      expect(child.querySelector('[role="img"]')).not.toBeNull()
    }
  })

  it('names every column for a screen reader, since the plot draws no numbers', () => {
    render(<BoxPlotRenderer visualization={visualization} data={data} />)

    expect(screen.getByRole('img', { name: 'A: Max 5, Q3 4, Median 3, Q1 2, Min 1' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'B: Max 8, Q3 6.50, Median 5, Q1 3.50, Min 2' })).toBeInTheDocument()
  })

  it('names its outliers too, rather than leaving a dot no reader can account for', () => {
    const withOutlier: QueryResultData = {
      columns,
      rows: [1, 2, 2, 3, 3, 4, 40].map((v) => ({ grp: 'A', v })),
    }
    render(<BoxPlotRenderer visualization={visualization} data={withOutlier} />)

    expect(screen.getByRole('img', { name: /1 outlier: 40$/ })).toBeInTheDocument()
  })

  it('carries no native title attribute, which is the tooltip the repo bans', () => {
    const { container } = render(<BoxPlotRenderer visualization={visualization} data={data} />)

    expect(container.querySelectorAll('[title]')).toHaveLength(0)
  })

  it('explains a column on hover, in a tooltip rather than a title', async () => {
    const user = userEvent.setup()
    render(<BoxPlotRenderer visualization={visualization} data={data} />)

    expect(screen.queryByText('Median')).not.toBeInTheDocument()
    await user.hover(screen.getByRole('img', { name: /^B:/ }))
    await waitFor(() => {
      expect(screen.getByText('Median')).toBeInTheDocument()
    })
  })

  it('explains a column on keyboard focus, which a title never reaches', async () => {
    const user = userEvent.setup()
    render(<BoxPlotRenderer visualization={visualization} data={data} />)

    await user.tab()
    expect(screen.getByRole('img', { name: /^A:/ })).toHaveFocus()
    await waitFor(() => {
      expect(screen.getByText('Median')).toBeInTheDocument()
    })
  })

  // A distribution that lives far from zero must not be squeezed into the top
  // of the plot by an axis anchored at zero: the axis covers the data's own
  // extent, so no tick sits at 0 and the ticks that do appear bracket the data.
  it('does not anchor the axis at zero for a distribution far from zero', () => {
    render(<BoxPlotRenderer visualization={visualization} data={farFromZero()} />)

    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('140')).toBeInTheDocument()
  })

  it('still labels zero when the distribution genuinely straddles it', () => {
    const straddlingZero: QueryResultData = {
      columns,
      rows: [-8, -5, -2, 0, 2, 5, 8].map((v) => ({ grp: 'A', v })),
    }
    render(<BoxPlotRenderer visualization={visualization} data={straddlingZero} />)

    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('-5')).toBeInTheDocument()
  })
})
