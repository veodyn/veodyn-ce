import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { renderWithProviders } from '@/test/utils'

// Through the providers, not a bare render: this component reads Settings >
// Formats (useFormats, and so useQuery) to hand every renderer the display
// formats it writes dates in, and a query hook throws without a client.
vi.mock('./bar-chart', () => ({ BarChart: () => <div>bar-chart</div> }))
vi.mock('./line-area-chart', () => ({
  LineAreaChart: ({ variant }: { variant: string }) => <div>line-area:{variant}</div>,
}))
vi.mock('./pie-chart', () => ({ PieChart: () => <div>pie-chart</div> }))
vi.mock('./scatter-chart', () => ({ ScatterChart: () => <div>scatter-chart</div> }))

import { ChartRenderer } from './index'

const data: QueryResultData = {
  columns: [
    { name: 'x', friendly_name: 'X', type: 'string' },
    { name: 'y', friendly_name: 'Y', type: 'integer' },
  ],
  rows: [{ x: 'a', y: 1 }],
}

function visualization(globalSeriesType?: string): MockVisualization {
  return {
    id: 1,
    type: 'CHART',
    name: 'Chart',
    description: '',
    options: {
      globalSeriesType,
      columnMapping: { x: 'x', y: 'y' },
    },
    created_at: '',
    updated_at: '',
  }
}

describe('ChartRenderer dispatch', () => {
  it('renders a bar chart for globalSeriesType=bar', () => {
    renderWithProviders(<ChartRenderer visualization={visualization('bar')} data={data} />)

    expect(screen.getByText('bar-chart')).toBeInTheDocument()
  })

  it.each([undefined, 'line'])('renders a line chart for globalSeriesType=%s', (chartType) => {
    renderWithProviders(<ChartRenderer visualization={visualization(chartType)} data={data} />)

    expect(screen.getByText('line-area:line')).toBeInTheDocument()
  })

  it('renders a pie chart for globalSeriesType=pie', () => {
    renderWithProviders(<ChartRenderer visualization={visualization('pie')} data={data} />)

    expect(screen.getByText('pie-chart')).toBeInTheDocument()
  })

  it('renders a scatter chart for globalSeriesType=scatter', () => {
    renderWithProviders(<ChartRenderer visualization={visualization('scatter')} data={data} />)

    expect(screen.getByText('scatter-chart')).toBeInTheDocument()
  })
})
