import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { DEFAULT_DISPLAY_PATTERNS } from '@/lib/date-pattern'
import { BarChart } from './bar-chart'
import type { ResolvedChartConfig } from './resolve-config'
import type { QueryResultData } from '@/lib/mock-data'

// recharts' ResponsiveContainer never renders past a zero-size host in jsdom;
// see line-area-chart.annotations.test.tsx for the full rationale.
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

const HIGHEST_VALUE = 100

const data: QueryResultData = {
  columns: [
    { name: 'route', friendly_name: 'route', type: 'string' },
    { name: 'trips', friendly_name: 'trips', type: 'integer' },
  ],
  rows: [
    { route: 'A', trips: 10 },
    { route: 'B', trips: 55 },
    { route: 'C', trips: HIGHEST_VALUE },
  ],
}

function config(overrides: Partial<ResolvedChartConfig> = {}): ResolvedChartConfig {
  return {
    chartType: 'bar',
    xCol: 'route',
    yRightCols: [],
    effectiveYCols: ['trips'],
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

// The numeric tick at the far end of the value axis, which is the end of the
// axis itself. jsdom measures every tick label as the width of the whole chart,
// so recharts' collision pass ("preserveEnd") drops all but the last one: the
// one tick that survives is the one this asks about, and no other tick is
// observable here.
function farEndTick(container: HTMLElement): number {
  const values = Array.from(container.querySelectorAll('.recharts-cartesian-axis-tick-value'))
    .map((tick) => Number(tick.textContent))
    .filter((value) => Number.isFinite(value))

  return values[values.length - 1] ?? Number.NaN
}

describe('bar chart value axis headroom', () => {
  it('runs its horizontal value axis past the longest bar', () => {
    // A swapped bar chart's value axis is the one along the bottom, and it is
    // the only value axis in the renderers that does not come from
    // yAxisPropsFor. Left on recharts' default it ended exactly at the longest
    // bar, which put that bar's end on the frame.
    const { container } = render(
      <BarChart config={config({ swappedAxes: true })} chartData={data.rows} data={data} patterns={DEFAULT_DISPLAY_PATTERNS} />,
    )

    expect(farEndTick(container)).toBeGreaterThan(HIGHEST_VALUE)
  })

  it('runs its vertical value axis past the tallest bar', () => {
    // The ordinary layout takes the same headroom through yAxisPropsFor, at
    // the top of the plot instead of at its right-hand end.
    const { container } = render(
      <BarChart config={config()} chartData={data.rows} data={data} patterns={DEFAULT_DISPLAY_PATTERNS} />,
    )

    expect(farEndTick(container)).toBeGreaterThan(HIGHEST_VALUE)
  })
})
