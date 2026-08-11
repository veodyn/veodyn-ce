import { sortRowsByDateX } from '@/lib/chart-format'
import type { QueryResultData } from '@/lib/mock-data'
import { indexSeries } from './index-series'
import type { ResolvedChartConfig } from './resolve-config'
import { rightAxisSeriesKey, rightAxisSeriesNamesFor, seriesNamesFor } from './resolve-config'

export function buildChartData(data: QueryResultData, config: ResolvedChartConfig): Record<string, unknown>[] {
  let rows: Record<string, unknown>[]

  if (config.seriesCol) {
    const seriesCol = config.seriesCol
    const groups = new Map<string, Record<string, unknown>>()
    for (const row of data.rows) {
      const x = String(row[config.xCol])
      const group = groups.get(x) ?? { [config.xCol]: row[config.xCol] }
      const seriesName = String(row[seriesCol])
      for (const yCol of config.effectiveYCols) {
        group[seriesName] = row[yCol]
      }
      // A yRight column has no single value at this x once rows are split by
      // series: North's row and South's row can each carry a different
      // number for it. Keying by rightAxisSeriesKey(yRightCol, seriesName)
      // instead of the bare column name means this row only ever writes its
      // own (x, series) slot, never a shared one another row can silently
      // overwrite. Before this, `group[yRightCol] = row[yRightCol]` was one
      // slot every row sharing this x wrote to, so whichever row was written
      // last won, an arbitrary result that was then drawn and labelled as a
      // single real series (see rightAxisSeriesNamesFor in resolve-config.ts).
      for (const yRightCol of config.yRightCols) {
        group[rightAxisSeriesKey(yRightCol, seriesName)] = row[yRightCol]
      }
      groups.set(x, group)
    }
    rows = Array.from(groups.values())
  } else {
    rows = data.rows
  }

  if (config.xIsDatetime) {
    rows = sortRowsByDateX(rows, config.xCol)
  }

  if (config.reverseX) {
    rows = [...rows].reverse()
  }

  // Indexing has to run after sorting and reversing: the base for each
  // series is its first nonzero value in plotted, left-to-right order, not
  // the first row of the raw query result. config.indexed is already resolved
  // against stacking in resolveChartConfig (stacking sums series, indexed
  // series are ratios, and ratios are not summable, so stacking forces
  // indexed off there), so it is not rechecked here: "is this chart actually
  // indexed" is decided in exactly one place, not this one plus
  // resolveChartConfig, which is what let indexed-plus-stack draw raw,
  // summed magnitudes under an indexed label before this was fixed.
  //
  // Every series the chart actually draws must be indexed together, which is
  // seriesNamesFor(config, data) (the left-axis series) plus
  // rightAxisSeriesNamesFor(config, data) (the actual keys the pivot above
  // wrote, not the bare yRightCols names once a series column has expanded
  // them). Indexing only the left-axis series and leaving the right-axis
  // series raw drew mixed units (indexed ratios and raw magnitudes) on one
  // axis labelled "indexed", which is strictly worse than the dual-axis
  // rendering this phase replaced. Indexing a right-axis series that a
  // particular layout does not draw (bar in vertical layout) is harmless, so
  // the rule stays simple rather than per-renderer.
  if (config.indexed) {
    rows = indexSeries(rows, config.xCol, [...seriesNamesFor(config, data), ...rightAxisSeriesNamesFor(config, data)])
  }

  if (config.stacking === 'percent') {
    rows = normalizeToPercent(rows, config.xCol, seriesNamesFor(config, data))
  }

  return rows
}

function normalizeToPercent(
  rows: Record<string, unknown>[],
  xCol: string,
  keys: string[],
): Record<string, unknown>[] {
  return rows.map((row) => {
    const total = keys.reduce((sum, k) => sum + (Number(row[k]) || 0), 0)
    if (total === 0) return row
    const next: Record<string, unknown> = { [xCol]: row[xCol] }
    for (const k of keys) {
      next[k] = ((Number(row[k]) || 0) / total) * 100
    }
    return next
  })
}
