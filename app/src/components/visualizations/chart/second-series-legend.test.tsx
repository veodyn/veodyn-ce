import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DISPLAY_PATTERNS } from '@/lib/date-pattern'
import { render, screen } from '@testing-library/react'
import { LineAreaChart } from './line-area-chart'
import { BarChart } from './bar-chart'
import { chartFrameHeight } from './chart-frame'
import type { ResolvedChartConfig } from './resolve-config'
import type { QueryResultData } from '@/lib/mock-data'

// recharts' ResponsiveContainer measures its host div via
// getBoundingClientRect in a useEffect and refuses to render children until it
// sees a positive width and height. jsdom's layout engine always returns an
// all-zero rect, so without this stub neither chart (nor its legend) mounts.
// See line-area-chart.annotations.test.tsx for the same rationale.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 800,
    height: 400,
    top: 0,
    left: 0,
    bottom: 400,
    right: 800,
    x: 0,
    y: 0,
    toJSON() {
      return this
    },
  } as DOMRect)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// One ordinary column, one yRightCols column: seriesNamesFor only ever
// returns the ordinary column, so a naive `seriesNames.length` reads 1 even
// though the chart draws two coloured series, both on the single axis.
const secondSeriesConfig: ResolvedChartConfig = {
  chartType: 'line',
  xCol: 'day',
  yRightCols: ['right'],
  effectiveYCols: ['left'],
  indexed: false,
  stacking: 'disabled',
  xIsDatetime: false,
  xHasTime: false,
  swappedAxes: false,
  reverseX: false,
  showDataLabels: false,
  donut: false,
  seriesOptions: {},
  yAxis: [],
  referenceLines: [],
}

const chartData = [
  { day: 'Mon', left: 10, right: 100 },
  { day: 'Tue', left: 20, right: 90 },
]

const data: QueryResultData = {
  columns: [
    { name: 'day', friendly_name: 'Day', type: 'string' },
    { name: 'left', friendly_name: 'Left', type: 'integer' },
    { name: 'right', friendly_name: 'Right', type: 'integer' },
  ],
  rows: chartData,
}

describe('yRightCols series are counted for the legend and the frame', () => {
  it('LineAreaChart mounts a legend for one ordinary column and one yRightCols column', () => {
    render(<LineAreaChart variant="line" config={secondSeriesConfig} chartData={chartData} data={data} patterns={DEFAULT_DISPLAY_PATTERNS} />)

    expect(screen.getByRole('list', { name: 'Chart legend' })).toBeInTheDocument()
  })

  it('LineAreaChart reserves a legend row in the frame height for the yRightCols series', () => {
    render(<LineAreaChart variant="line" config={secondSeriesConfig} chartData={chartData} data={data} patterns={DEFAULT_DISPLAY_PATTERNS} />)

    const frame = screen.getByTestId('chart-frame')
    expect(frame).toHaveStyle({
      height: `var(--chart-frame-fill, ${chartFrameHeight({ seriesCount: 2, hasAxisBand: true })}px)`,
    })
  })

  it('BarChart mounts a legend for one ordinary column and one yRightCols column', () => {
    render(<BarChart config={secondSeriesConfig} chartData={chartData} data={data} patterns={DEFAULT_DISPLAY_PATTERNS} />)

    expect(screen.getByRole('list', { name: 'Chart legend' })).toBeInTheDocument()
  })

  // The line/area renderer has always passed `seriesOptions[name]?.name` for
  // its right-axis marks; the bar renderer did not, so a rename written for a
  // right-axis series by the editor's Series section was honored on one chart
  // shape and silently dropped on the other.
  it('BarChart honors a rename for a yRightCols series in the legend', () => {
    const config = {
      ...secondSeriesConfig,
      seriesOptions: { right: { name: 'Renamed right' } },
    }
    render(<BarChart config={config} chartData={chartData} data={data} patterns={DEFAULT_DISPLAY_PATTERNS} />)

    expect(screen.getByText('Renamed right')).toBeInTheDocument()
  })

  it('BarChart reserves a legend row in the frame height for the yRightCols series', () => {
    render(<BarChart config={secondSeriesConfig} chartData={chartData} data={data} patterns={DEFAULT_DISPLAY_PATTERNS} />)

    const frame = screen.getByTestId('chart-frame')
    expect(frame).toHaveStyle({
      height: `var(--chart-frame-fill, ${chartFrameHeight({ seriesCount: 2, hasAxisBand: true })}px)`,
    })
  })
})
