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
      // series, so keying by rightAxisSeriesKey(yRightCol, seriesName) gives
      // each (x, series) its own slot. The bare column name is one slot every
      // row at this x writes to, and the last write wins.
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

  // Runs after sorting and reversing: each series' base is its first nonzero
  // value in plotted order, not in raw query order. Whether a chart is indexed
  // at all is decided only in resolveChartConfig, which also forces it off
  // under stacking, so it is not rechecked here.
  //
  // Left-axis and right-axis series index together, or one axis carries mixed
  // units. The right-axis names come from rightAxisSeriesNamesFor, which is the
  // keys the pivot above actually wrote, not the bare yRightCols.
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
