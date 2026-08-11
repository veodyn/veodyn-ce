// A one-paragraph text summary of a chart, used as the plot's accessible
// name. Pure: no React, no DOM, so it is testable without rendering anything.
//
// Numbers are stated in full (toLocaleString), not with the axis's compact
// formatter (formatCompactNumber, "1.2M"): the summary is the only route a
// reader without the plot has to the values, so rounding them the way the
// axis does would defeat it. When the chart is effectively indexed
// (config.indexed) chartData holds ratios rather than the query's original
// numbers, and this module cannot recover the originals from an indexed row,
// so it says so rather than presenting a ratio as an exact source value.

import { formatDateLabel } from '@/lib/chart-format'
import type { DisplayPatterns } from '@/lib/date-pattern'
import { INDEXED_BASE_DESCRIPTION } from './axis-config'
import type { ResolvedChartConfig } from './resolve-config'

// How an x value reads in the summary: a datetime through the same label
// formatter the axis uses, in the same configured format, so the sentence names
// the dates a sighted reader sees rather than a raw timestamp in a form nothing
// else in the product uses.
function formatXCell(value: unknown, config: ResolvedChartConfig, patterns: DisplayPatterns): string {
  if (config.xIsDatetime) return formatDateLabel(value, config.xHasTime, patterns)
  return String(value)
}

// A number, or a string that parses as one, is numeric. Everything else
// (including a boolean or a Date, both of which are Number()-coercible: a
// boolean to 0/1, a Date to its millisecond timestamp) is not, and reads as
// its own String() rather than as a misleading number.
function isNumericLike(value: unknown): value is number | string {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return value.trim() !== '' && Number.isFinite(Number(value))
  return false
}

// seriesNames is the series the caller is actually about to draw (or has
// drawn): line and area pass seriesNames plus config.yRightCols, bar passes
// the same only in horizontal layout, scatter passes its group names, pie
// its slice names. This module does not re-derive that set from config,
// because config alone (e.g. config.yRightCols) does not say whether a
// given chart type or layout draws it: pie and scatter never read
// yRightCols at all, and bar only draws it in horizontal layout. Guessing
// here would be a second place that has to be kept in sync with every
// renderer's drawing rule; taking the array as a parameter makes the
// summary agree with its chart by construction instead.

// A pie has slices, not an x axis and a y axis: the generic axis-based
// summary below is not approximately true for one, it is a different shape
// of claim about a different kind of chart. seriesNames[0] is the one value
// column a pie actually draws (see pie-chart.tsx); config.xCol supplies each
// slice's name.
function pieChartSummary(
  config: ResolvedChartConfig,
  chartData: Record<string, unknown>[],
  seriesNames: string[],
  patterns: DisplayPatterns,
): string {
  const valueCol = seriesNames[0]
  const slices = chartData.map((row) => ({
    name: formatXCell(row[config.xCol], config, patterns),
    rawValue: row[valueCol],
  }))
  const sliceCount = slices.length
  const namesSentence = `This pie chart has ${sliceCount} slice${sliceCount === 1 ? '' : 's'}: ${slices.map((s) => s.name).join(', ')}.`

  // isNumericLike (shared with the table's own cell formatting, above) skips
  // a non-numeric slice value rather than letting Number(...) coerce it into
  // a plausible-looking but meaningless share of the total.
  const numericSlices = slices
    .filter((s) => isNumericLike(s.rawValue))
    .map((s) => ({ name: s.name, value: Number(s.rawValue) }))

  if (numericSlices.length === 0) {
    return `${namesSentence} No numeric values are present.`
  }

  const total = numericSlices.reduce((sum, s) => sum + s.value, 0)
  const largest = numericSlices.reduce((a, b) => (b.value > a.value ? b : a))
  const shareSentence = total !== 0
    ? `${largest.name} is the largest slice at ${largest.value.toLocaleString()}, about ${Math.round((largest.value / total) * 100)} percent of the total.`
    : `${largest.name} is the largest slice at ${largest.value.toLocaleString()}.`

  return [namesSentence, shareSentence].join(' ')
}

export function chartSummary(
  config: ResolvedChartConfig,
  chartData: Record<string, unknown>[],
  seriesNames: string[],
  patterns: DisplayPatterns,
): string {
  if (chartData.length === 0) {
    return `This ${config.chartType} chart has no data.`
  }

  if (config.chartType === 'pie') {
    return pieChartSummary(config, chartData, seriesNames, patterns)
  }

  const firstX = formatXCell(chartData[0][config.xCol], config, patterns)
  const lastX = formatXCell(chartData[chartData.length - 1][config.xCol], config, patterns)

  // The ceiling and floor must come from every series column across every
  // row, not just the first series: a reader asking "what's the highest
  // value on this chart" is asking about the whole plot, not one line.
  // isNumericLike (shared with the table's own cell formatting, above) skips
  // a boolean or Date cell rather than letting Number(...) coerce it into a
  // plausible-looking but meaningless range (a boolean series would
  // otherwise report "ranges from 0 to 1" as though 0 and 1 were measured
  // quantities).
  let min = Infinity
  let max = -Infinity
  for (const row of chartData) {
    for (const name of seriesNames) {
      if (!isNumericLike(row[name])) continue
      const num = Number(row[name])
      if (num < min) min = num
      if (num > max) max = num
    }
  }

  const rangeSentence = Number.isFinite(min) && Number.isFinite(max)
    ? `The y axis ranges from ${min.toLocaleString()} to ${max.toLocaleString()}.`
    : 'No numeric y values are present.'

  // Deliberately does not claim every series starts at 100: index-series.ts
  // divides by the base's magnitude and keeps the original sign, so a series
  // that starts negative is indexed to -100.
  const indexedSentence = config.indexed
    ? ` Values are indexed to 100 at each series' ${INDEXED_BASE_DESCRIPTION}, not the original numbers (a series that started negative reads as -100).`
    : ''

  return [
    `This ${config.chartType} chart plots ${seriesNames.join(', ')}.`,
    `The x axis runs from ${firstX} to ${lastX}.`,
    `${rangeSentence}${indexedSentence}`,
  ].join(' ')
}
