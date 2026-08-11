import { describe, expect, it } from 'vitest'
import { formatDateLabel } from '@/lib/chart-format'
import { INDEXED_BASE_DESCRIPTION } from './axis-config'
import type { ResolvedChartConfig } from './resolve-config'
import { chartSummary } from './chart-summary'

// Copied from axis-config.test.ts's configWithYAxis and adjusted: xCol/
// effectiveYCols swapped in for this file's two-series fixture. showLegend
// does not belong here (see resolve-config.ts).
function baseConfig(overrides: Partial<ResolvedChartConfig> = {}): ResolvedChartConfig {
  return {
    chartType: 'line',
    xCol: 'month',
    yRightCols: [],
    effectiveYCols: ['revenue', 'cost'],
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

const config = baseConfig()

// The display formats a summary writes its dates in. ISO-style, which is what
// the summary used to hardcode, so the assertions below still describe the same
// strings; the setting-follows case has its own test.
const PATTERNS = { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' }

// The series a renderer actually draws for `config`/`chartData` below: both
// functions now take this as an explicit parameter rather than deriving it
// themselves (see chart-summary.ts for why).
const seriesNames = ['revenue', 'cost']

const chartData = [
  { month: 'Jan', revenue: 100, cost: 200 },
  { month: 'Feb', revenue: 150, cost: 250 },
]

// The requirement is that a value the summary states is never run through
// the axis's compact formatter, and that has nothing to do with config, only
// the raw chart data. So this varies the data, not the config, and a
// compact-formatter regression makes it fail: 1_200_000 would read "1.2M"
// instead of "1,200,000".
const chartDataWithLargeNumber = [{ month: 'Jan', revenue: 1_200_000, cost: 200 }]

// cost holds the maximum (900) while revenue's maximum (300) is smaller, so
// an implementation that only scans the first series column would compute a
// ceiling of 300 and never emit "900".
const chartDataWhereCostIsLargest = [
  { month: 'Jan', revenue: 100, cost: 500 },
  { month: 'Feb', revenue: 300, cost: 900 },
]

const datetimeConfig = baseConfig({
  xCol: 'day',
  effectiveYCols: ['revenue'],
  xIsDatetime: true,
  xHasTime: true,
})
const datetimeSeriesNames = ['revenue']

const datetimeRows = [
  { day: '2026-01-15T08:30:00', revenue: 100 },
  { day: '2026-01-16T09:15:00', revenue: 200 },
]

describe('chartSummary', () => {
  it('names the chart type and every series', () => {
    expect(chartSummary(config, chartData, seriesNames, PATTERNS)).toContain('revenue')
    expect(chartSummary(config, chartData, seriesNames, PATTERNS)).toContain('cost')
  })

  it('states the x range', () => {
    expect(chartSummary(config, chartData, seriesNames, PATTERNS)).toContain('Jan')
    expect(chartSummary(config, chartData, seriesNames, PATTERNS)).toContain('Feb')
  })

  it('states the y range across all series, not just the first', () => {
    // cost holds the maximum; a summary that reads only the first series
    // would report the wrong ceiling.
    expect(chartSummary(config, chartDataWhereCostIsLargest, seriesNames, PATTERNS)).toContain('900')
  })

  it('does not name a right-axis series the chart does not actually draw', () => {
    const configWithUndrawnRightAxis = baseConfig({ effectiveYCols: ['revenue'], yRightCols: ['forecast'] })
    const rows = [{ month: 'Jan', revenue: 100, forecast: 900 }]

    expect(chartSummary(configWithUndrawnRightAxis, rows, ['revenue'], PATTERNS)).not.toContain('forecast')
  })

  it('says so plainly when there is no data', () => {
    expect(chartSummary(config, [], seriesNames, PATTERNS)).toMatch(/no data/i)
  })

  it('mentions the values are indexed, not the original numbers, when the chart is effectively indexed', () => {
    const indexedConfig = baseConfig({ indexed: true })

    const summary = chartSummary(indexedConfig, chartData, seriesNames, PATTERNS)

    expect(summary).toMatch(/indexed/i)
    // Must not claim every series starts at 100 (a series starting negative
    // starts at -100), so the caveat itself is part of what is asserted.
    expect(summary).toMatch(/-100/)
  })

  it('states the identical base the indexed axis label states', () => {
    // The axis label and the summary are two descriptions of one chart, so a
    // reader who can see the plot and a reader who cannot must be told the
    // same thing about where 100 sits. Sharing the constant is what makes
    // that true; asserting only /indexed/ would let the two drift apart.
    const summary = chartSummary(baseConfig({ indexed: true }), chartData, seriesNames, PATTERNS)

    expect(summary).toContain(INDEXED_BASE_DESCRIPTION)
  })

  it('states a large value in full rather than through the axis compact formatter', () => {
    // The summary is the only route to the numbers for a reader who cannot
    // see the plot, so rounding them the way the axis does would defeat it.
    const summary = chartSummary(config, chartDataWithLargeNumber, seriesNames, PATTERNS)

    expect(summary).toContain('1,200,000')
    expect(summary).not.toContain('1.2M')
  })

  it('reads a datetime x range as formatted labels, not raw timestamps', () => {
    // Same formatter the axis ticks use, so the sentence names the ticks a
    // sighted reader sees rather than an ISO string.
    const summary = chartSummary(datetimeConfig, datetimeRows, datetimeSeriesNames, PATTERNS)

    expect(summary).toContain(formatDateLabel('2026-01-15T08:30:00', true, PATTERNS))
    expect(summary).toContain(formatDateLabel('2026-01-16T09:15:00', true, PATTERNS))
    expect(summary).not.toContain('2026-01-15T08:30:00')
  })

  it('writes those labels in the configured format, like every other date in the product', () => {
    // A reader who cannot see the plot gets this sentence instead of the axis,
    // so it has to follow the same setting the axis does.
    const summary = chartSummary(datetimeConfig, datetimeRows, datetimeSeriesNames, {
      dateFormat: 'DD/MM/YYYY',
      timeFormat: 'hh:mm A',
    })

    expect(summary).toContain('15/01/2026 08:30 AM')
    expect(summary).not.toContain('2026-01-15')
  })

  it('says nothing about indexing for an ordinary, unindexed chart', () => {
    expect(chartSummary(config, chartData, seriesNames, PATTERNS)).not.toMatch(/indexed/i)
  })

  it('does not coerce a boolean series into a nonsense numeric range', () => {
    // Number(true) === 1 and Number(false) === 0, both finite, so a naive
    // Number(...) coercion would report "ranges from 0 to 1" as though 0 and
    // 1 were measured quantities rather than a boolean flag.
    const boolRows = [
      { month: 'Jan', status: true },
      { month: 'Feb', status: false },
    ]

    const summary = chartSummary(config, boolRows, ['status'], PATTERNS)

    expect(summary).toMatch(/no numeric/i)
    expect(summary).not.toMatch(/ranges from/i)
  })
})

describe('chartSummary for a pie chart', () => {
  const pieConfig = baseConfig({ chartType: 'pie', xCol: 'browser', effectiveYCols: ['share'] })
  const pieRows = [
    { browser: 'Chrome', share: 60 },
    { browser: 'Firefox', share: 40 },
  ]

  it('describes slices, not an x axis and a y axis, which a pie does not have', () => {
    const summary = chartSummary(pieConfig, pieRows, ['share'], PATTERNS)

    expect(summary).toMatch(/slice/i)
    expect(summary).not.toMatch(/x axis/i)
    expect(summary).not.toMatch(/y axis/i)
  })

  it('names every slice and identifies the largest', () => {
    const summary = chartSummary(pieConfig, pieRows, ['share'], PATTERNS)

    expect(summary).toContain('Chrome')
    expect(summary).toContain('Firefox')
    expect(summary).toMatch(/Chrome.*largest/i)
  })

  it('says so plainly when no slice has a numeric value, rather than reporting a nonsense range', () => {
    const nonNumericRows = [
      { browser: 'Chrome', share: 'n/a' },
      { browser: 'Firefox', share: 'n/a' },
    ]

    const summary = chartSummary(pieConfig, nonNumericRows, ['share'], PATTERNS)

    expect(summary).toMatch(/no numeric/i)
    expect(summary).toContain('Chrome')
  })
})
