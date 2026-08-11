import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DISPLAY_PATTERNS } from '@/lib/date-pattern'
import { render, screen } from '@testing-library/react'
import { LineAreaChart } from './line-area-chart'
import { BarChart } from './bar-chart'
import { INDEXED_AXIS_LABEL_TEXT } from './axis-config'
import type { ResolvedChartConfig } from './resolve-config'
import type { QueryResultData } from '@/lib/mock-data'

// recharts' ResponsiveContainer measures its host div via
// getBoundingClientRect in a useEffect and refuses to render children until it
// sees a positive width and height. jsdom's layout engine always returns an
// all-zero rect, so without this stub neither chart mounts. See
// line-area-chart.annotations.test.tsx for the same rationale.
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

function baseConfig(overrides: Partial<ResolvedChartConfig> = {}): ResolvedChartConfig {
  return {
    chartType: 'line',
    xCol: 'day',
    yRightCols: [],
    effectiveYCols: ['value'],
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
    ...overrides,
  }
}

const chartData = [
  { day: 'Mon', value: 10 },
  { day: 'Tue', value: 20 },
]

const data: QueryResultData = {
  columns: [
    { name: 'day', friendly_name: 'Day', type: 'string' },
    { name: 'value', friendly_name: 'Value', type: 'integer' },
  ],
  rows: chartData,
}

// Each case below asserts both directions in the same test: an
// implementation that always shows the label (ignores config.indexed) fails
// the unindexed half, and one that never wires the label at all (the
// likelier bug, since it looks identical to "correctly hidden" from an
// absence-only assertion) fails the indexed half. A test asserting only
// absence cannot tell "never wired" from "correctly gated", so it stays
// paired with its presence counterpart rather than standing alone.
describe('the value axis names itself as an index when config.indexed is true', () => {
  it('LineAreaChart\'s left axis', () => {
    const { unmount } = render(
      <LineAreaChart variant="line" config={baseConfig({ indexed: true })} chartData={chartData} data={data} patterns={DEFAULT_DISPLAY_PATTERNS} />,
    )
    expect(screen.getByText(INDEXED_AXIS_LABEL_TEXT)).toBeInTheDocument()
    unmount()

    render(<LineAreaChart variant="line" config={baseConfig({ indexed: false })} chartData={chartData} data={data} patterns={DEFAULT_DISPLAY_PATTERNS} />)
    expect(screen.queryByText(INDEXED_AXIS_LABEL_TEXT)).not.toBeInTheDocument()
  })

  it('BarChart\'s left axis, ordinary horizontal-bars layout', () => {
    const { unmount } = render(<BarChart config={baseConfig({ indexed: true })} chartData={chartData} data={data} patterns={DEFAULT_DISPLAY_PATTERNS} />)
    expect(screen.getByText(INDEXED_AXIS_LABEL_TEXT)).toBeInTheDocument()
    unmount()

    render(<BarChart config={baseConfig({ indexed: false })} chartData={chartData} data={data} patterns={DEFAULT_DISPLAY_PATTERNS} />)
    expect(screen.queryByText(INDEXED_AXIS_LABEL_TEXT)).not.toBeInTheDocument()
  })

  // swappedAxes puts the value axis on the bottom (an XAxis) instead of the
  // left (a YAxis): without its own label there, an indexed chart with
  // horizontal bars shows ratio numbers with nothing saying they are a
  // ratio, and a reader can mistake them for raw magnitudes.
  it('BarChart\'s bottom value axis, swapped (vertical bars) layout', () => {
    const { unmount } = render(
      <BarChart config={baseConfig({ indexed: true, swappedAxes: true })} chartData={chartData} data={data} patterns={DEFAULT_DISPLAY_PATTERNS} />,
    )
    expect(screen.getByText(INDEXED_AXIS_LABEL_TEXT)).toBeInTheDocument()
    unmount()

    render(<BarChart config={baseConfig({ indexed: false, swappedAxes: true })} chartData={chartData} data={data} patterns={DEFAULT_DISPLAY_PATTERNS} />)
    expect(screen.queryByText(INDEXED_AXIS_LABEL_TEXT)).not.toBeInTheDocument()
  })
})
