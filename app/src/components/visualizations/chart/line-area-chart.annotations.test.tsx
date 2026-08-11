import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DISPLAY_PATTERNS } from '@/lib/date-pattern'
import { render, screen } from '@testing-library/react'
import { LineAreaChart, annotationLabel } from './line-area-chart'
import type { ResolvedChartConfig } from './resolve-config'
import type { QueryResultData } from '@/lib/mock-data'
import type { PlacedAnnotation } from '@/lib/annotation-overlay'

// recharts' ResponsiveContainer measures its host div via
// getBoundingClientRect in a useEffect and refuses to render children (or
// the reference elements under test) until it sees a positive width and
// height. jsdom's layout engine always returns an all-zero rect, so without
// this stub ComposedChart never mounts and the annotation assertions below
// would false-negative on an empty container rather than a real failure.
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
  xCol: 'day',
  yRightCols: [],
  effectiveYCols: ['value'],
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
  { day: '2026-01-01', value: 10 },
  { day: '2026-01-02', value: 20 },
  { day: '2026-01-03', value: 15 },
  { day: '2026-01-04', value: 25 },
  { day: '2026-01-05', value: 30 },
]

const data: QueryResultData = {
  columns: [
    { name: 'day', friendly_name: 'Day', type: 'date' },
    { name: 'value', friendly_name: 'Value', type: 'integer' },
  ],
  rows: chartData,
}

const annotations: PlacedAnnotation[] = [
  { id: 1, label: 'Launch day', x: '2026-01-02', x2: null },
  { id: 2, label: 'Outage window', x: '2026-01-01', x2: '2026-01-04' },
]

describe('LineAreaChart annotations', () => {
  it('renders a point annotation label via ReferenceLine', () => {
    render(<LineAreaChart variant="line" config={config} chartData={chartData} data={data} annotations={annotations} patterns={DEFAULT_DISPLAY_PATTERNS} />)
    expect(screen.getByText('Launch day')).toBeInTheDocument()
  })

  it('renders a range annotation label via ReferenceArea', () => {
    render(<LineAreaChart variant="line" config={config} chartData={chartData} data={data} annotations={annotations} patterns={DEFAULT_DISPLAY_PATTERNS} />)
    expect(screen.getByText('Outage window')).toBeInTheDocument()
  })

  it('renders no annotation markers when annotations is empty', () => {
    render(<LineAreaChart variant="line" config={config} chartData={chartData} data={data} annotations={[]} patterns={DEFAULT_DISPLAY_PATTERNS} />)
    expect(screen.queryByText('Launch day')).not.toBeInTheDocument()
    expect(screen.queryByText('Outage window')).not.toBeInTheDocument()
  })

  it('still renders correctly when annotations is omitted', () => {
    render(<LineAreaChart variant="line" config={config} chartData={chartData} data={data} patterns={DEFAULT_DISPLAY_PATTERNS} />)
    expect(screen.queryByText('Launch day')).not.toBeInTheDocument()
  })
})

describe('annotationLabel', () => {
  it('staggers consecutive labels onto different rows so they cannot overprint', () => {
    const offsets = [0, 1, 2, 3].map((i) => annotationLabel('Event', i).offset)

    expect(new Set(offsets.slice(0, 3)).size).toBe(3)
    // Row 4 wraps back to row 1, which is far enough apart to stay legible.
    expect(offsets[3]).toBe(offsets[0])
  })

  it('caps a long label so it cannot run past the plot', () => {
    const long = 'Winter storm reduces ridership across the entire network'
    const { value } = annotationLabel(long, 0)

    expect(value.length).toBeLessThanOrEqual(28)
    expect(value.endsWith('…')).toBe(true)
  })

  it('leaves a short label untouched', () => {
    expect(annotationLabel('Line 6 opens', 0).value).toBe('Line 6 opens')
  })
})
