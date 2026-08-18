import { detectDateColumn } from '@/lib/chart-format'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import type { RedashAxisOptions, RedashChartOptions, RedashReferenceLine, RedashSeriesOptions } from '@/services/redash/types'
import { type ChartShape, resolveChartShape } from './chart-shape'

export interface ResolvedChartConfig {
  chartType: ChartShape
  xCol: string
  yRightCols: string[]
  seriesCol?: string
  // Redash's `size` role: ScatterChart binds it to a ZAxis so each mark's area
  // carries the value. Set only when the column can carry it (see sizesAsArea).
  sizeCol?: string
  effectiveYCols: string[]
  // Every series rendered as a percentage of its own first nonzero value, on
  // one shared axis, instead of raw magnitude on one or two independent scales.
  indexed: boolean
  stacking: 'stack' | 'percent' | 'disabled'
  xIsDatetime: boolean
  // true when the x column has sub-day granularity (Redash/column type
  // 'datetime'): date labels then include the time so same-day points
  // stay distinguishable; plain 'date' columns render as YYYY-MM-DD only.
  xHasTime: boolean
  swappedAxes: boolean
  reverseX: boolean
  showDataLabels: boolean
  donut: boolean
  seriesOptions: Record<string, RedashSeriesOptions>
  yAxis: RedashAxisOptions[]
  referenceLines: RedashReferenceLine[]
}

const NUMERIC_TYPES = new Set(['integer', 'float', 'decimal'])
const DATE_TYPES = new Set(['date', 'datetime'])

/**
 * The y columns to plot when nothing is mapped to y: every numeric column that
 * is not already carrying the x or the series.
 */
export function inferYColumns(data: QueryResultData, xCol: string, seriesCol?: string): string[] {
  return data.columns
    .filter((c) => c.name !== xCol && c.name !== seriesCol && NUMERIC_TYPES.has(c.type))
    .map((c) => c.name)
}

/**
 * The x column to plot when nothing is mapped to x: the first column, unless
 * taking it would empty the y set (a query leading with its aggregate, as in
 * 'SELECT count(*), category'), in which case the first non-numeric column.
 * Exported so the visualization editor seeds an explicit mapping from this rule.
 */
export function inferXColumn(data: QueryResultData): string {
  const first = data.columns[0]
  if (first == null) return ''
  if (inferYColumns(data, first.name).length > 0) return first.name
  return data.columns.find((c) => !NUMERIC_TYPES.has(c.type))?.name ?? first.name
}

/**
 * This module's own inference, written out as a mapping the chart editor can
 * show and save. Empty when there is nothing to infer: a half mapping (an x
 * with no y) replaces the fallback above without standing in for it, and the
 * chart then draws nothing.
 */
export function inferChartColumnMapping(data: QueryResultData): Record<string, 'x' | 'y'> {
  const xCol = inferXColumn(data)
  const yCols = inferYColumns(data, xCol)
  if (xCol === '' || yCols.length === 0) return {}
  return { [xCol]: 'x', ...Object.fromEntries(yCols.map((c) => [c, 'y' as const])) }
}

// Shared by resolveChartConfig and the chart editor's "Index to 100" checkbox,
// so both agree on whether a chart is effectively indexed. Every input comes
// from options alone, so the editor can call it without any query data.
export function effectiveIndexed(options: RedashChartOptions): boolean {
  const chartType = resolveChartShape(options.globalSeriesType)
  const columnMapping = options.columnMapping || {}
  const yRightCols = Object.entries(columnMapping).filter(([, v]) => v === 'yRight').map(([k]) => k)
  const stacking = options.series?.stacking ?? (options.stacking === 'stack' ? 'stack' : 'disabled')

  // Migration: a saved chart that relied on a second y-scale (a per-series right
  // axis, or a column mapped to yRight) is inferred as indexed. This reads the
  // old fields and never rewrites them, so a rollback restores the old rendering.
  const hadRightAxisSignal =
    Object.values(options.seriesOptions ?? {}).some((s) => s.yAxis === 1) || yRightCols.length > 0
  const wantsIndexed = typeof options.indexed === 'boolean' ? options.indexed : hadRightAxisSignal

  // Stacking wins over indexing: stacking sums series, indexed series are
  // ratios, and ratios are not summable. buildChartData and the renderers read
  // config.indexed as the final answer rather than rechecking stacking.
  //
  // Scatter and pie are never indexed whatever the stored option says:
  // ChartRenderer passes them data.rows directly, never the indexed chartData,
  // so buildChartTableModel would otherwise label raw rows "indexed to 100".
  return chartType !== 'scatter' && chartType !== 'pie' && wantsIndexed && stacking === 'disabled'
}

/**
 * Whether a column mapped to Redash's `size` role can really size the marks.
 * False when the result no longer carries the column (a stale mapping, which
 * missingMappedColumns in lib/visualizations/validate-columns.ts reports), and
 * false on any negative value: recharts cannot clip a negative z domain (ZAxis
 * ignores allowDataOverflow) and Scatter reads an exact 0 as "no z value", so
 * sizes of -10, -1, 0, 1 render as areas of 64, 849, 64, 1024.
 */
function sizesAsArea(column: string, data: QueryResultData): boolean {
  if (!data.columns.some((c) => c.name === column)) return false
  // Number() rather than typeof: a ClickHouse Decimal arrives as a string. Null
  // and unparseable text fail this comparison, so recharts draws them at the floor.
  return !data.rows.some((row) => Number(row[column]) < 0)
}

export function resolveChartConfig(visualization: MockVisualization, data: QueryResultData): ResolvedChartConfig {
  const options = (visualization.options ?? {}) as RedashChartOptions
  const chartType = resolveChartShape(options.globalSeriesType)
  const columnMapping = options.columnMapping || {}

  const xCol = Object.entries(columnMapping).find(([, v]) => v === 'x')?.[0] || inferXColumn(data)
  const yCols = Object.entries(columnMapping).filter(([, v]) => v === 'y').map(([k]) => k)
  const yRightCols = Object.entries(columnMapping).filter(([, v]) => v === 'yRight').map(([k]) => k)
  const seriesCol = Object.entries(columnMapping).find(([, v]) => v === 'series')?.[0]
  const mappedSizeCol = Object.entries(columnMapping).find(([, v]) => v === 'size')?.[0]
  const sizeCol =
    mappedSizeCol != null && sizesAsArea(mappedSizeCol, data) ? mappedSizeCol : undefined

  // A column explicitly mapped to yRight or to size is dropped from the
  // inferred y set: that slot already claims it, and a numeric size column
  // would otherwise both size the points and draw as an ordinary y series.
  // Keyed off the MAPPED name, so a size column this chart declined to draw
  // stays out of the y axis rather than reappearing there as a series.
  const effectiveYCols =
    yCols.length > 0
      ? yCols
      : inferYColumns(data, xCol, seriesCol).filter(
          (name) => !yRightCols.includes(name) && name !== mappedSizeCol
        )

  const stacking: ResolvedChartConfig['stacking'] =
    options.series?.stacking ?? (options.stacking === 'stack' ? 'stack' : 'disabled')

  // The declared type is checked first because it is authoritative when it is
  // there, but it is not always there: a ClickHouse DateTime64 column comes
  // back typed as a string, so the values get a look too (detectDateColumn).
  const xColumnType = data.columns.find((c) => c.name === xCol)?.type
  const declaredDate = xColumnType != null && DATE_TYPES.has(xColumnType)
  const detected = declaredDate ? null : detectDateColumn(data.rows.map((row) => row[xCol]))
  const xIsDatetime = options.xAxis?.type === 'datetime' || declaredDate || (detected?.isDate ?? false)
  const xHasTime =
    options.xAxis?.type === 'datetime' || xColumnType === 'datetime' || (detected?.hasTime ?? false)

  const indexed = effectiveIndexed(options)

  return {
    chartType,
    xCol,
    yRightCols,
    seriesCol,
    sizeCol,
    effectiveYCols,
    indexed,
    stacking,
    xIsDatetime,
    xHasTime,
    swappedAxes: options.swappedAxes ?? false,
    reverseX: options.reverseX ?? false,
    showDataLabels: options.showDataLabels ?? false,
    donut: options.donut ?? false,
    seriesOptions: options.seriesOptions ?? {},
    yAxis: options.yAxis ?? [],
    referenceLines: options.referenceLines ?? [],
  }
}

export function seriesNamesFor(config: ResolvedChartConfig, data: QueryResultData): string[] {
  const seriesCol = config.seriesCol
  return seriesCol
    ? [...new Set(data.rows.map((r) => String(r[seriesCol])))]
    : config.effectiveYCols
}

// How the scatter renderer names a group of rows sharing one series value.
// Null and '' both land here: a '' key would collide with the renderer's
// anonymous no-series group, whose `name || xCol` fallback reroutes the color
// lookup to the x column's name. Shared with the editor's per-series section.
export const UNGROUPED_SERIES_LABEL = 'Ungrouped'

export function scatterSeriesKey(value: unknown): string {
  return value == null || value === '' ? UNGROUPED_SERIES_LABEL : String(value)
}

// The names drawn right-axis series actually carry in chartData. With no
// series column that is config.yRightCols unchanged; once a series column
// pivots one x into one row per series, a right-axis column has no single
// value at that x, so this resolves one series per (right column, series
// value) pair. Shared by buildChartData's pivot, both renderers that draw
// right-axis series (line/area and bar's horizontal layout), the table twin,
// and indexSeries, which must all build exactly these keys.
export function rightAxisSeriesNamesFor(config: ResolvedChartConfig, data: QueryResultData): string[] {
  if (!config.seriesCol) return config.yRightCols
  const seriesValues = seriesNamesFor(config, data)
  return config.yRightCols.flatMap((col) => seriesValues.map((series) => rightAxisSeriesKey(col, series)))
}

export function rightAxisSeriesKey(yRightCol: string, seriesValue: string): string {
  return `${yRightCol} (${seriesValue})`
}

export function curveTypeFor(name: string, config: ResolvedChartConfig, fallback: 'linear' | 'monotone' | 'step' | 'natural') {
  return config.seriesOptions[name]?.curve ?? fallback
}
