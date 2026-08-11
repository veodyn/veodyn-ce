import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { LineAreaChart } from './line-area-chart'
import { BarChart } from './bar-chart'
import { ScatterChart } from './scatter-chart'
import type { ResolvedChartConfig } from './resolve-config'
import type { QueryResultData } from '@/lib/mock-data'

// planXAxis (x-axis-config.tsx) is tested in isolation next door. This file
// tests the other half of that feature: that each renderer actually PUTS the
// plan on its axis and draws against the rows the plan hands back. Both are
// easy to lose without breaking anything else, because a renderer that
// ignores the plan still compiles, still draws a chart, and still passes
// every test that was written against it before the plan existed. So the
// assertions below are about rendered geometry and rendered tick text, the
// two things that actually differ between a time axis and a row-ordered one.
//
// recharts' ResponsiveContainer never renders past a zero-size host in
// jsdom; see line-area-chart.annotations.test.tsx for the full rationale.
function rectOf(width: number, height: number): DOMRect {
  return {
    width,
    height,
    top: 0,
    left: 0,
    bottom: height,
    right: width,
    x: 0,
    y: 0,
    toJSON() {
      return this
    },
  } as DOMRect
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    // The legend measures itself the same way and recharts takes its height
    // out of the plot's. A blanket 400px there leaves the plot -1px tall and
    // recharts renders no marks at all, so the legend measures as nothing and
    // the plot keeps the whole box.
    const inLegend = this.closest?.('.recharts-legend-wrapper') != null
    return inLegend ? rectOf(0, 0) : rectOf(800, 400)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const config: ResolvedChartConfig = {
  chartType: 'line',
  xCol: 'ts',
  yRightCols: [],
  effectiveYCols: ['value'],
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

// An ISO-style display setting, which is the form these axes used to hardcode,
// so the label assertions below read the same as they always did. The setting
// that a chart follows one is asserted at the bottom of the file, against a
// deliberately different pair.
const ISO_PATTERNS = { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' }

// Deliberately unevenly spaced: 16 minutes between the first two points and
// 26 between the last two. On a time scale the middle point sits 16/42 of the
// way along; in row order it sits exactly halfway. That gap is what tells a
// real time axis from a category axis wearing date labels, and it is the only
// thing that does, since both draw three points and both label them.
const rows = [
  { ts: '2026-07-22 15:22:25.919', value: 4 },
  { ts: '2026-07-22 15:38:25.919', value: 6 },
  { ts: '2026-07-22 16:04:25.919', value: 2 },
]
const TIME_FRACTION = 16 / 42

const data: QueryResultData = {
  columns: [
    { name: 'ts', friendly_name: 'ts', type: 'datetime' },
    { name: 'value', friendly_name: 'value', type: 'integer' },
  ],
  rows,
}

// Every <text> recharts emits for the x axis, tick labels and the second
// context line alike. They live in their own zIndex layer rather than inside
// .recharts-xAxis, which is why this does not select through that class.
function xTickLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.recharts-xAxis-tick-labels text')).map(
    (node) => node.textContent ?? '',
  )
}

// The on-curve vertices of a recharts line: the M point, then the last of
// each cubic's three control points. The control points in between are
// interpolation artefacts and say nothing about where a row landed.
function lineVertexXs(container: HTMLElement): number[] {
  const d = container.querySelector('.recharts-line-curve')?.getAttribute('d') ?? ''
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  const xs: number[] = []
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    if ((i / 2) % 3 === 0) xs.push(numbers[i])
  }
  return xs
}

function scatterPointXs(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('.recharts-symbols')).map((node) => {
    const match = /translate\((-?\d+(?:\.\d+)?)/.exec(node.getAttribute('transform') ?? '')
    return match == null ? NaN : Number(match[1])
  })
}

function barXs(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('.recharts-rectangle')).map((node) =>
    Number(node.getAttribute('x')),
  )
}

// The middle point of three, expressed as where it fell between the outer
// two. Geometry-independent: it does not care how wide the plot came out or
// where its margins are, only whether the gap between points reflects the
// time between them.
function middleFraction(xs: number[]): number {
  return (xs[1] - xs[0]) / (xs[2] - xs[0])
}

describe('LineAreaChart datetime x axis', () => {
  it('spaces points by the time between them, not one step per row', () => {
    const { container } = render(
      <LineAreaChart variant="line" config={config} chartData={rows} data={data} patterns={ISO_PATTERNS} />,
    )
    const xs = lineVertexXs(container)

    expect(xs).toHaveLength(3)
    // Row order would put this at 0.5. A time scale puts it at 16/42.
    expect(middleFraction(xs)).toBeCloseTo(TIME_FRACTION, 3)
  })

  it('labels ticks on round boundaries the rows themselves never contain', () => {
    const { container } = render(
      <LineAreaChart variant="line" config={config} chartData={rows} data={data} patterns={ISO_PATTERNS} />,
    )
    const labels = xTickLabels(container)

    // 15:30 is a boundary between two rows, so no row's own value can produce
    // it: only ticks chosen off the time span can.
    expect(labels).toContain('15:30')
    // And nothing renders a raw cell, which is what a plain category axis
    // over this column does.
    expect(labels.some((label) => label.includes('15:22:25.919'))).toBe(false)
  })

  it('states the date once, under the first tick', () => {
    const { container } = render(
      <LineAreaChart variant="line" config={config} chartData={rows} data={data} patterns={ISO_PATTERNS} />,
    )

    // The plan's own tick renderer draws this second line. A tick styled from
    // the chrome tokens alone draws the time and nothing under it, leaving an
    // axis of bare clock times with no day attached.
    expect(xTickLabels(container).filter((label) => label === '2026-07-22')).toHaveLength(1)
  })
})

describe('ScatterChart datetime x axis', () => {
  const scatterConfig = { ...config, chartType: 'scatter' as const }

  it('spaces points by the time between them, not one step per row', () => {
    const { container } = render(<ScatterChart config={scatterConfig} data={data} patterns={ISO_PATTERNS} />)
    const xs = scatterPointXs(container)

    expect(xs).toHaveLength(3)
    expect(middleFraction(xs)).toBeCloseTo(TIME_FRACTION, 3)
  })

  it('spaces a grouped scatter by time too', () => {
    // A series column sends the rows down a second path (one Scatter per
    // group), which is a separate chance to hand recharts the raw rows and
    // lose the epoch mirror the axis is keyed on.
    const groupedConfig = { ...scatterConfig, seriesCol: 'region' }
    const groupedData: QueryResultData = {
      columns: [...data.columns, { name: 'region', friendly_name: 'region', type: 'string' }],
      rows: [
        { ...rows[0], region: 'north' },
        { ...rows[1], region: 'south' },
        { ...rows[2], region: 'north' },
      ],
    }

    const { container } = render(<ScatterChart config={groupedConfig} data={groupedData} patterns={ISO_PATTERNS} />)
    // Sorted, because the points come out grouped: north's two, then south's.
    const xs = scatterPointXs(container).sort((a, b) => a - b)

    expect(xs).toHaveLength(3)
    expect(middleFraction(xs)).toBeCloseTo(TIME_FRACTION, 3)
  })

  it('labels ticks on round boundaries and states the date once', () => {
    const { container } = render(<ScatterChart config={scatterConfig} data={data} patterns={ISO_PATTERNS} />)
    const labels = xTickLabels(container)

    expect(labels).toContain('15:30')
    expect(labels.some((label) => label.includes('15:22:25.919'))).toBe(false)
    expect(labels.filter((label) => label === '2026-07-22')).toHaveLength(1)
  })
})

describe('BarChart datetime x axis', () => {
  // rangeMin pins the value axis at zero. On an auto domain the smallest bar
  // is exactly zero units tall and recharts emits no rect for it, which would
  // leave the band spacing below with only two positions to measure.
  const barConfig = { ...config, chartType: 'bar' as const, yAxis: [{ rangeMin: 0 }] }

  it('keeps bars on equal category bands', () => {
    const { container } = render(<BarChart config={barConfig} chartData={rows} data={data} patterns={ISO_PATTERNS} />)
    const xs = barXs(container)

    expect(xs).toHaveLength(3)
    // A bar needs a band to size itself against, so this axis stays
    // categorical: three rows, three equal steps, whatever the gaps in time.
    expect(middleFraction(xs)).toBeCloseTo(0.5, 3)
  })

  it('still shortens its tick labels to the span, rather than printing whole timestamps', () => {
    const { container } = render(<BarChart config={barConfig} chartData={rows} data={data} patterns={ISO_PATTERNS} />)
    const labels = xTickLabels(container)

    expect(labels.length).toBeGreaterThan(0)
    // Category bands, but span-aware labels: a bare category axis over this
    // column prints '2026-07-22 15:22:25' under every bar.
    for (const label of labels) {
      expect(label).toMatch(/^\d{2}:\d{2}$/)
    }
    expect(labels).toContain('15:22')
  })
})

describe('one display setting, every date a chart writes', () => {
  // A 12-hour clock and a day-first date, which shares no character sequence
  // with the ISO form the charts used to hardcode: any surface that kept the old
  // form shows up as a failure here rather than passing by coincidence.
  const EUROPEAN_TWELVE_HOUR = { dateFormat: 'DD/MM/YYYY', timeFormat: 'hh:mm A' }

  it('labels the ticks, the date line under them, and the accessible summary alike', () => {
    // Threading the setting to one of these and not the others is the failure
    // mode this file exists to catch: each is a separate call site, each looks
    // right on its own, and a chart that names the same instant two ways is
    // worse than one that names it in a form nobody chose.
    const { container, getByRole } = render(
      <LineAreaChart variant="line" config={config} chartData={rows} data={data} patterns={EUROPEAN_TWELVE_HOUR} />,
    )
    const labels = xTickLabels(container)

    expect(labels).toContain('03:30 PM')
    expect(labels).toContain('22/07/2026')
    expect(labels).not.toContain('15:30')
    expect(getByRole('img').getAttribute('aria-label')).toContain('22/07/2026 03:22:25 PM')
  })

  it('carries the setting through a scatter and a bar chart too', () => {
    const scatter = render(<ScatterChart config={{ ...config, chartType: 'scatter' }} data={data} patterns={EUROPEAN_TWELVE_HOUR} />)

    expect(xTickLabels(scatter.container)).toContain('03:30 PM')
    scatter.unmount()

    const bar = render(
      <BarChart
        config={{ ...config, chartType: 'bar', yAxis: [{ rangeMin: 0 }] }}
        chartData={rows}
        data={data}
        patterns={EUROPEAN_TWELVE_HOUR}
      />,
    )

    // Spaces removed before comparing: a bar chart's tick labels go through
    // recharts' own <Text>, which word-wraps by splitting on spaces into
    // separate <tspan>s, so the meridiem arrives in the DOM as its own node and
    // textContent reads "03:22PM". The label on screen has the space.
    const barLabels = xTickLabels(bar.container).map((label) => label.replace(/\s+/g, ''))

    expect(barLabels).toContain('03:22PM')
  })
})
