// A combo chart: Redash lets each series declare its own type, so one series
// can be bars while another stays a line. This renderer honoured 'area' and let
// everything else fall through to <Line>, so a bar-and-line chart drew two lines
// and lost its bars with no error anywhere.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { DEFAULT_DISPLAY_PATTERNS } from '@/lib/date-pattern'
import type { QueryResultData } from '@/lib/mock-data'
import { LineAreaChart } from './line-area-chart'
import type { ResolvedChartConfig } from './resolve-config'

// recharts measures its host div and draws nothing until it sees a positive
// width and height, which jsdom never reports on its own.
//
// The legend needs its own answer, and this is the trap. Every other chart test
// here mocks one rect for all elements, which works only because a single-series
// chart hides its legend. A combo chart needs two series, so the legend renders,
// measures itself through this same mock, reports 400px tall, and recharts
// subtracts the whole plot away: the clip path comes out `height="0"` and not one
// mark is drawn. The failure looks exactly like "the Bar branch does not work",
// including for the pure-line control case.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const height = this.classList.contains('recharts-legend-wrapper') ? 24 : 400
    return {
      width: 800,
      height,
      top: 0,
      left: 0,
      bottom: height,
      right: 800,
      x: 0,
      y: 0,
      toJSON() {
        return this
      },
    } as DOMRect
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const baseConfig: ResolvedChartConfig = {
  chartType: 'line',
  xCol: 'day',
  yRightCols: [],
  effectiveYCols: ['revenue', 'orders'],
  indexed: false,
  stacking: 'disabled',
  xIsDatetime: true,
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
  { day: '2026-01-01', revenue: 10, orders: 3 },
  { day: '2026-01-02', revenue: 20, orders: 5 },
  { day: '2026-01-03', revenue: 15, orders: 4 },
]

const data: QueryResultData = {
  columns: [
    { name: 'day', friendly_name: 'Day', type: 'date' },
    { name: 'revenue', friendly_name: 'Revenue', type: 'integer' },
    { name: 'orders', friendly_name: 'Orders', type: 'integer' },
  ],
  rows: chartData,
}

function renderWith(seriesOptions: ResolvedChartConfig['seriesOptions']) {
  const { container } = render(
    <LineAreaChart
      variant="line"
      config={{ ...baseConfig, seriesOptions }}
      chartData={chartData}
      data={data}
      patterns={DEFAULT_DISPLAY_PATTERNS}
    />
  )
  return container
}

// recharts tags each mark's group with a class naming the mark, which is the
// only handle on "which shape did this series actually draw" that does not
// depend on pixel geometry jsdom cannot produce.
const bars = (c: HTMLElement) => c.querySelectorAll('.recharts-bar')
const lines = (c: HTMLElement) => c.querySelectorAll('.recharts-line')

describe('LineAreaChart combo series', () => {
  it('draws a series marked as bars with bars, not with a line', () => {
    const container = renderWith({ revenue: { type: 'column' }, orders: { type: 'line' } })
    expect(bars(container)).toHaveLength(1)
    expect(lines(container)).toHaveLength(1)
  })

  // 'column' is Redash's spelling and 'bar' is this app's own. Both reach this
  // renderer through saved options, so both have to mean the same mark.
  it('accepts this app own bar spelling as well as Redash column', () => {
    expect(bars(renderWith({ revenue: { type: 'bar' }, orders: { type: 'line' } }))).toHaveLength(1)
  })

  // The regression guard. Without the Bar branch this case drew two lines and
  // zero bars, which is what shipped.
  it('leaves a chart with no per-series types entirely as lines', () => {
    const container = renderWith({})
    expect(bars(container)).toHaveLength(0)
    expect(lines(container)).toHaveLength(2)
  })

  it('still honours area, so the branch added here did not displace it', () => {
    const container = renderWith({ revenue: { type: 'area' }, orders: { type: 'column' } })
    expect(container.querySelectorAll('.recharts-area')).toHaveLength(1)
    expect(bars(container)).toHaveLength(1)
  })
})

// The right-axis series go through a second map that ignored per-series type
// entirely, so a column mapped to yRight drew as a line however it was marked.
// Every case above pins yRightCols to [], which is exactly why none of them
// could see it.
describe('LineAreaChart combo series on the right axis', () => {
  function renderRight(seriesOptions: ResolvedChartConfig['seriesOptions']) {
    const { container } = render(
      <LineAreaChart
        variant="line"
        config={{
          ...baseConfig,
          effectiveYCols: ['revenue'],
          yRightCols: ['orders'],
          seriesOptions,
        }}
        chartData={chartData}
        data={data}
        patterns={DEFAULT_DISPLAY_PATTERNS}
      />
    )
    return container
  }

  it('draws a right-axis series marked as bars with bars', () => {
    const container = renderRight({ orders: { type: 'column' } })
    expect(bars(container)).toHaveLength(1)
    expect(lines(container)).toHaveLength(1)
  })

  it('leaves an unmarked right-axis series as a line', () => {
    const container = renderRight({})
    expect(bars(container)).toHaveLength(0)
    expect(lines(container)).toHaveLength(2)
  })

  // The three gaps the per-series editor made visible: the right-axis map
  // honored 'column' but let 'area' fall through to a line, drew its line
  // marks under the raw key rather than the stored rename, and pinned the
  // curve to monotone while the main series read curveTypeFor.
  it('draws a right-axis series marked as area with an area', () => {
    const container = renderRight({ orders: { type: 'area' } })
    expect(container.querySelectorAll('.recharts-area')).toHaveLength(1)
  })

  it('honors a rename for a right-axis line series in the legend', () => {
    const container = renderRight({ orders: { name: 'Order count' } })
    expect(container.textContent).toContain('Order count')
  })

  it('honors a curve override for a right-axis line series', () => {
    // A linear curve is straight segments only; the monotone default emits
    // cubic (C) commands. The path's own commands are the only handle jsdom
    // has on which curve was drawn.
    const container = renderRight({ orders: { curve: 'linear' } })
    const paths = container.querySelectorAll('.recharts-line-curve')
    expect(paths).toHaveLength(2)
    const rightPath = paths[1]?.getAttribute('d') ?? ''
    expect(rightPath).not.toContain('C')
  })
})
