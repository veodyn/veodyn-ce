import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DISPLAY_PATTERNS } from '@/lib/date-pattern'
import { render, screen, within } from '@testing-library/react'
import { LineAreaChart } from './line-area-chart'
import type { ResolvedChartConfig } from './resolve-config'
import type { QueryResultData } from '@/lib/mock-data'

// recharts de-duplicates the legend payload only when `payloadUniqBy` is set:
// getUniqPayload (recharts@3.8.0, util/payload/getUniqPayload.js) otherwise
// falls through to `return payload`, and legendDefaultProps leaves the prop
// undefined. No `<Legend>` in this tree passes it, so two series sharing a
// display name both keep their legend item. Locked in here, because adding
// `payloadUniqBy` later would silently change it.
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
  effectiveYCols: ['a', 'b'],
  indexed: false,
  stacking: 'disabled',
  xIsDatetime: false,
  xHasTime: false,
  swappedAxes: false,
  reverseX: false,
  showDataLabels: false,
  donut: false,
  // Two distinct columns given the same display name: a user choice that makes
  // an ambiguous chart, not a bug to disambiguate.
  seriesOptions: { a: { name: 'Total' }, b: { name: 'Total' } },
  yAxis: [],
  referenceLines: [],
}

const chartData = [
  { day: 'Mon', a: 10, b: 100 },
  { day: 'Tue', a: 20, b: 90 },
]

const data: QueryResultData = {
  columns: [
    { name: 'day', friendly_name: 'Day', type: 'string' },
    { name: 'a', friendly_name: 'A', type: 'integer' },
    { name: 'b', friendly_name: 'B', type: 'integer' },
  ],
  rows: chartData,
}

describe('recharts does not de-duplicate our legend payload by displayed value', () => {
  it('keeps both entries when two series share a display name', () => {
    render(<LineAreaChart variant="line" config={config} chartData={chartData} data={data} patterns={DEFAULT_DISPLAY_PATTERNS} />)

    const legend = screen.getByRole('list', { name: 'Chart legend' })
    const items = within(legend).getAllByRole('listitem')

    expect(items).toHaveLength(2)
    expect(items.every((li) => li.textContent === 'Total')).toBe(true)
  })
})
