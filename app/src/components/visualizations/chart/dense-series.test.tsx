// A dense capture, mounted, so the reduction is asserted where it actually
// happens rather than only on the pure function.
//
// The rule is covered in downsample.test.ts. What this file is for: that the
// chart really draws the reduced rows, and that thinning them costs the reader
// nothing, since the accessible summary still states the true range.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DISPLAY_PATTERNS } from '@/lib/date-pattern'
import { render, screen } from '@testing-library/react'
import { LineAreaChart } from './line-area-chart'
import { MAX_PLOTTED_ROWS } from './downsample'
import type { ResolvedChartConfig } from './resolve-config'
import type { QueryResultData } from '@/lib/mock-data'

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

const config: ResolvedChartConfig = {
  chartType: 'line',
  xCol: 'at',
  yRightCols: [],
  effectiveYCols: ['speed'],
  indexed: false,
  stacking: 'disabled',
  xIsDatetime: true,
  xHasTime: true,
  swappedAxes: false,
  reverseX: false,
  showDataLabels: false,
  donut: false,
  seriesOptions: {},
  yAxis: [],
  referenceLines: [],
}

// A day of minute-resolution capture, the shape the report came from, with one
// spike an hour in and one trough near the end.
const START = Date.parse('2026-07-24T00:00:00Z')
const SPIKE_AT = 60
const TROUGH_AT = 1_300
const rows = Array.from({ length: 1_440 }, (_, index) => ({
  at: new Date(START + index * 60_000).toISOString().slice(0, 19).replace('T', ' '),
  speed: index === SPIKE_AT ? 97 : index === TROUGH_AT ? -13 : 5 + (index % 4),
}))

const data: QueryResultData = {
  columns: [
    { name: 'at', friendly_name: 'At', type: 'datetime' },
    { name: 'speed', friendly_name: 'Speed', type: 'float' },
  ],
  rows,
}

// The on-curve vertices of the drawn line. Recharts emits one M and then a
// command per row, so the vertices are the command letters: counting only M
// and L misses every cubic and reports 1 for a curve of a thousand points.
function drawnPointCount(container: HTMLElement): number {
  const d = container.querySelector('.recharts-line-curve')?.getAttribute('d') ?? ''
  return (d.match(/[MLC]/g) ?? []).length
}

describe('a dense series', () => {
  it('draws far fewer points than the query returned', () => {
    const { container } = render(
      <LineAreaChart variant="line" config={config} chartData={rows} data={data} patterns={DEFAULT_DISPLAY_PATTERNS} />
    )

    const drawn = drawnPointCount(container)
    expect(drawn).toBeGreaterThan(0)
    expect(drawn).toBeLessThanOrEqual(MAX_PLOTTED_ROWS)
    expect(drawn).toBeLessThan(rows.length)
  })

  it('still reports the true range in its accessible summary', () => {
    // The property that matters: the summary is the only route to the numbers
    // for a reader without the plot, so it must never understate them.
    //
    // Note what this does NOT prove. The summary is computed from the full
    // rows, but the downsampler pins every series' own peak and trough, so
    // computing it from the drawn rows would give the same answer and this
    // test would not notice. It is the guarantee that is asserted here, not
    // which array it was read from.
    render(<LineAreaChart variant="line" config={config} chartData={rows} data={data} patterns={DEFAULT_DISPLAY_PATTERNS} />)

    const summary = screen.getByRole('img').getAttribute('aria-label') ?? ''

    expect(summary).toContain('97')
    expect(summary).toContain('-13')
  })

  it('leaves a short series alone', () => {
    const few = rows.slice(0, 10)
    const { container } = render(
      <LineAreaChart variant="line" config={config} chartData={few} data={{ ...data, rows: few }} patterns={DEFAULT_DISPLAY_PATTERNS} />
    )

    expect(drawnPointCount(container)).toBe(few.length)
  })
})
