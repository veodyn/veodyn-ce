import type { QueryResultData } from '@/lib/mock-data'
import type { RedashBoxPlotOptions } from '@/services/redash/types'
import { formatExactNumber } from '@/lib/chart-format'

// Pure model for the box plot: no React, no DOM. Split out of
// box-plot-renderer.tsx along the same seam cohort-model.ts uses, so the
// statistics, the axis domain and the strings a screen reader reads can be
// asserted as plain input/output rather than only through a rendered plot.

export interface BoxStats {
  category: string
  min: number
  q1: number
  median: number
  q3: number
  max: number
  outliers: number[]
}

export interface BoxPlotModel {
  boxes: BoxStats[]
  domainMin: number
  domainMax: number
  ticks: number[]
}

export const EMPTY_BOX_PLOT_MODEL: BoxPlotModel = { boxes: [], domainMin: 0, domainMax: 1, ticks: [] }

const NUMERIC_TYPES = new Set(['integer', 'float', 'decimal'])

export function resolveBoxPlotColumns(
  options: RedashBoxPlotOptions,
  data: QueryResultData
): { categoryCol?: string; valueCol?: string } {
  const columnMapping = options.columnMapping ?? {}
  const categoryCol = Object.entries(columnMapping).find(([, v]) => v === 'category')?.[0] || data.columns[0]?.name
  const valueCol =
    Object.entries(columnMapping).find(([, v]) => v === 'value')?.[0]
    || data.columns.find((c) => c.name !== categoryCol && NUMERIC_TYPES.has(c.type))?.name
  return { categoryCol, valueCol }
}

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

export function computeBoxStats(category: string, values: number[]): BoxStats {
  const sorted = [...values].sort((a, b) => a - b)
  const q1 = percentile(sorted, 25)
  const median = percentile(sorted, 50)
  const q3 = percentile(sorted, 75)
  const iqr = q3 - q1
  const lowerFence = q1 - 1.5 * iqr
  const upperFence = q3 + 1.5 * iqr

  const inRange = sorted.filter((v) => v >= lowerFence && v <= upperFence)
  const outliers = sorted.filter((v) => v < lowerFence || v > upperFence)

  return {
    category,
    min: inRange[0] ?? sorted[0],
    q1,
    median,
    q3,
    max: inRange[inRange.length - 1] ?? sorted[sorted.length - 1],
    outliers,
  }
}

// Breathing room at each end of the axis, as a share of the data's own extent,
// so the tallest whisker and the lowest outlier are not drawn on the frame.
const DOMAIN_PADDING = 0.05
// Domain for a distribution with no spread at all (every sample identical),
// where a share of the extent would be zero. Scaled off the value itself so a
// flat series of 1000 does not get a domain of plus or minus half a unit.
const FLAT_PADDING = 0.05
const FLAT_PADDING_FLOOR = 0.5
// How many gridlines the axis aims for. Real tick count varies: ticks are
// round multiples inside the domain, not the domain's own endpoints.
const TICK_TARGET = 5

// The axis domain is the data's own extent, padded, and is deliberately NOT
// anchored at zero. Zero-anchoring is honest for a magnitude, where a mark's
// length from the baseline is the value (a bar). A box encodes position and
// spread: nothing about it is measured from zero, so a forced zero baseline
// adds empty plot instead of meaning. The demo fixture is the case that made
// this visible: corridor travel times of 22 to 93 minutes were all squeezed
// into the top of the plot over an empty lower two thirds.
//
// A distribution that genuinely straddles zero still reads correctly, because
// the domain then contains zero and every tick below is a labelled negative.
// Nothing here special-cases the sign.
export function computeBoxPlotDomain(boxes: BoxStats[]): { domainMin: number; domainMax: number } {
  const values = boxes.flatMap((b) => [b.min, b.max, ...b.outliers])
  if (values.length === 0) return { domainMin: 0, domainMax: 1 }
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo
  const pad = span > 0 ? span * DOMAIN_PADDING : Math.max(Math.abs(hi) * FLAT_PADDING, FLAT_PADDING_FLOOR)
  return { domainMin: lo - pad, domainMax: hi + pad }
}

// Round tick values INSIDE the domain, rather than slicing the domain itself
// into equal parts. Slicing labels the padded endpoints, which are arbitrary
// numbers (18.45, 96.55) nobody can read a value off. Snapping the domain to a
// round step instead would drag it back towards zero for data that lives far
// from it, undoing the fix above.
//
// Every tick is a multiple of the step, so zero is always among them when the
// domain contains zero: a distribution straddling zero gets a labelled zero
// line for free, with no special case.
export function computeAxisTicks(domainMin: number, domainMax: number): number[] {
  const span = domainMax - domainMin
  if (!(span > 0)) return [domainMin]
  const rawStep = span / (TICK_TARGET - 1)
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalized = rawStep / magnitude
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude
  const first = Math.ceil(domainMin / step) * step
  const ticks: number[] = []
  // The epsilon keeps a tick that lands exactly on the top of the domain from
  // being dropped by binary-float noise, and toPrecision(12) drops that same
  // noise from the value itself, which would otherwise label a round tick
  // 0.30000000000000004.
  const limit = domainMax + step * 1e-9
  for (let i = 0; first + i * step <= limit; i += 1) ticks.push(Number((first + i * step).toPrecision(12)))
  return ticks
}

export function buildBoxPlotModel(data: QueryResultData, categoryCol: string, valueCol: string): BoxPlotModel {
  const grouped = new Map<string, number[]>()
  for (const row of data.rows) {
    const category = String(row[categoryCol])
    const value = Number(row[valueCol])
    if (!Number.isFinite(value)) continue
    const values = grouped.get(category) ?? []
    values.push(value)
    grouped.set(category, values)
  }

  const boxes = Array.from(grouped.entries()).map(([category, values]) => computeBoxStats(category, values))
  if (boxes.length === 0) return EMPTY_BOX_PLOT_MODEL

  const { domainMin, domainMax } = computeBoxPlotDomain(boxes)
  return { boxes, domainMin, domainMax, ticks: computeAxisTicks(domainMin, domainMax) }
}

// The five-number summary in plot order, top to bottom, so the tooltip reads
// down the box the way the eye does.
export function boxSummaryRows(box: BoxStats): { label: string; value: string }[] {
  return [
    { label: 'Max', value: formatExactNumber(box.max) },
    { label: 'Q3', value: formatExactNumber(box.q3) },
    { label: 'Median', value: formatExactNumber(box.median) },
    { label: 'Q1', value: formatExactNumber(box.q1) },
    { label: 'Min', value: formatExactNumber(box.min) },
  ]
}

export function describeOutliers(box: BoxStats): string | null {
  if (box.outliers.length === 0) return null
  const noun = box.outliers.length === 1 ? 'outlier' : 'outliers'
  return `${box.outliers.length} ${noun}: ${box.outliers.map((v) => formatExactNumber(v)).join(', ')}`
}

// The one string a column's accessible name is built from, sharing its numbers
// with the tooltip through boxSummaryRows/describeOutliers. A box plot draws no
// text at all except the category label, so without this a screen reader gets
// the categories and nothing else: not a median, not a spread, not an outlier.
export function describeBox(box: BoxStats): string {
  const summary = boxSummaryRows(box)
    .map((row) => `${row.label} ${row.value}`)
    .join(', ')
  const outliers = describeOutliers(box)
  return `${box.category}: ${summary}${outliers ? `, ${outliers}` : ''}`
}
