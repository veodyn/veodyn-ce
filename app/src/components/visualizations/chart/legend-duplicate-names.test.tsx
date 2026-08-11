import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DISPLAY_PATTERNS } from '@/lib/date-pattern'
import { render, screen, within } from '@testing-library/react'
import { LineAreaChart } from './line-area-chart'
import type { ResolvedChartConfig } from './resolve-config'
import type { QueryResultData } from '@/lib/mock-data'

// Fix 3(b) from the phase 2 review fix brief claimed recharts de-duplicates
// the legend payload by displayed value before ChartLegend ever sees it, so
// two differently coloured series both renamed "Total" would collapse into
// one legend item.
//
// Reading the installed recharts@3.8.0 source
// (node_modules/recharts/es6/component/Legend.js and
// util/payload/getUniqPayload.js) shows this is conditional, not automatic:
// getUniqPayload only drops duplicates when the Legend's `payloadUniqBy` prop
// is `true` or a function; legendDefaultProps does not set it, so it is
// `undefined` by default, and getUniqPayload's fallthrough branch
// (`return payload`) returns every entry unchanged. Every `<Legend>` in this
// tree (bar-chart.tsx, line-area-chart.tsx, pie-chart.tsx, scatter-chart.tsx)
// renders `<Legend content={<ChartLegend />} />` with no `payloadUniqBy`, so
// none of them opt into de-duplication. The claim does not hold for this
// codebase's actual usage, so Fix 3(b) changes nothing: this test locks in
// today's real (non-deduplicating) behaviour as a regression guard, since
// this is the exact kind of claim someone will reintroduce by adding
// `payloadUniqBy` later without reading this file.
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
  // Two distinct columns deliberately given the same display name: a user
  // choice that produces an ambiguous chart, not a bug to disambiguate.
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
