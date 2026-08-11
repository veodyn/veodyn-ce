import { detectDateColumn } from '@/lib/chart-format'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import type { RedashAxisOptions, RedashChartOptions, RedashReferenceLine, RedashSeriesOptions } from '@/services/redash/types'
import { type ChartShape, resolveChartShape } from './chart-shape'

export interface ResolvedChartConfig {
  chartType: ChartShape
  xCol: string
  yRightCols: string[]
  seriesCol?: string
  // The column Redash put in its `size` role ("Bubble Size Column" in its own
  // editor), which is the whole difference between a bubble chart and the
  // scatter it shares a shape with: ScatterChart binds it to a ZAxis so each
  // mark's area carries the value. Set only when that column can really carry
  // it, so a renderer reading this never has to second-guess the name (see
  // sizesAsArea for the two ways a mapped column cannot).
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
 * The x column to plot when nothing is mapped to x. Exported so the
 * visualization editor can seed the same choice into an explicit mapping rather
 * than running a second, drifting copy of this rule.
 *
 * The first column, which is where a `SELECT dimension, aggregate` puts the
 * thing to plot against. Unless taking it would leave nothing to plot: when it
 * is the only numeric column, spending it on the x axis empties the y set and the
 * chart draws a pair of axes over no data. A query that leads with its aggregate
 * ('SELECT count(*), category') is exactly that shape.
 *
 * Reaching for the first non-numeric column instead can only affect a chart that
 * was drawing nothing, so no chart that renders today renders differently.
 */
export function inferXColumn(data: QueryResultData): string {
  const first = data.columns[0]
  if (first == null) return ''
  if (inferYColumns(data, first.name).length > 0) return first.name
  return data.columns.find((c) => !NUMERIC_TYPES.has(c.type))?.name ?? first.name
}

/**
 * This module's own inference, written out as a mapping the chart editor can
 * show and save.
 *
 * Empty when there is nothing to infer (no columns, or nothing numeric to plot).
 * Half a mapping is worse than none: an x with no y, or a y with no x, replaces
 * the fallback above without standing in for it, and the chart draws nothing.
 * Returning `{}` leaves this module in charge, which is where it started.
 */
export function inferChartColumnMapping(data: QueryResultData): Record<string, 'x' | 'y'> {
  const xCol = inferXColumn(data)
  const yCols = inferYColumns(data, xCol)
  if (xCol === '' || yCols.length === 0) return {}
  return { [xCol]: 'x', ...Object.fromEntries(yCols.map((c) => [c, 'y' as const])) }
}

// Shared by resolveChartConfig and the chart editor, so both agree on
// whether a chart is effectively indexed. Before this was pulled out, the
// editor's "Index to 100" checkbox read only the stored options.indexed
// (defaulting unticked), while the preview beside it read this same
// migration-aware value: a migrated chart with no stored `indexed` rendered
// an indexed preview next to an unticked box, and ticking then unticking it
// silently changed the saved state. Every input here (chart type, column
// mapping, series options, stacking) comes from options alone; resolving it
// needs no query data, so the editor can call it with just the options it
// already has.
export function effectiveIndexed(options: RedashChartOptions): boolean {
  const chartType = resolveChartShape(options.globalSeriesType)
  const columnMapping = options.columnMapping || {}
  const yRightCols = Object.entries(columnMapping).filter(([, v]) => v === 'yRight').map(([k]) => k)
  const stacking = options.series?.stacking ?? (options.stacking === 'stack' ? 'stack' : 'disabled')

  // Migration: a saved chart that relied on a second y-scale (a per-series
  // right axis, or a column mapped to yRight) is inferred as indexed so it
  // renders honestly without anyone editing stored options. This reads the
  // old fields, it never rewrites them, so a rollback restores the old
  // rendering from unchanged saved JSON.
  const hadRightAxisSignal =
    Object.values(options.seriesOptions ?? {}).some((s) => s.yAxis === 1) || yRightCols.length > 0
  const wantsIndexed = typeof options.indexed === 'boolean' ? options.indexed : hadRightAxisSignal

  // buildChartData and the renderers both read config.indexed as the final
  // answer instead of rechecking stacking themselves: two places computing
  // that question used to disagree (buildChartData skipped indexing under
  // stacking, but the renderers showed the indexed axis label regardless),
  // so indexed plus stack drew raw, summed magnitudes under a label that
  // claimed they were ratios. Stacking sums series; indexed series are
  // ratios; ratios are not summable, so stacking wins over indexing here,
  // which is the existing rendering behaviour, just made honest in one
  // field instead of implied by two.
  //
  // A scatter or pie chart is never indexed, regardless of what stacking or
  // the stored option or the migration signal say. Scatter's y values are not
  // a series over an ordered x, so "indexed to its first nonzero value" has
  // no clear meaning there, and ScatterChart plots data.rows directly rather
  // than an indexed chartData. A pie has slices of one whole at one point in
  // time, not a series over an ordered x either, and PieChart likewise plots
  // and tabulates data.rows directly (see ChartRenderer, which computes an
  // indexed chartData for line/bar/area but never passes it to PieChart or
  // ScatterChart). Without this, a stored chart carrying indexed: true or a
  // migrated yRight mapping, switched to pie, would have buildChartTableModel
  // label PieChart's raw data.rows as "indexed to 100": reachable through
  // saved JSON, since changing globalSeriesType alone preserves every other
  // stored option, and the editor hides the Index control for pie so there is
  // no way to untick it there either. The editor does not offer the control
  // for scatter or pie for the same reason; this keeps the config honest even
  // for a saved chart whose options predate that.
  return chartType !== 'scatter' && chartType !== 'pie' && wantsIndexed && stacking === 'disabled'
}

/**
 * Whether a column mapped to Redash's `size` role can really size the marks.
 * Two ways it cannot, and neither shows up as an error at draw time.
 *
 * The result may not carry the column at all. A visualization still mapping
 * `old_weight` after the query stopped selecting it points the ZAxis at a key
 * no row has, and recharts hands every one of those points the same fallback
 * mark: a plain scatter that answers a narrower question than the stored chart
 * claims to. Returning false here draws that scatter deliberately, and
 * missingMappedColumns (lib/visualizations/validate-columns.ts, which is why
 * `size` is back in its role set) is what tells the reader the name is stale.
 *
 * Or the column may hold a negative value, which is not a quantity an area can
 * carry. recharts will not refuse it and cannot be asked to: ZAxis ignores an
 * allowDataOverflow prop and passes implicitZAxis.allowDataOverflow, which is
 * false, so extendDomain grows a [0, dataMax] domain down to dataMin rather
 * than clipping to it. Scatter separately reads an exact 0 as "no z value" and
 * gives that row the range floor. Rendered, sizes of -10, -1, 0 and 1 come out
 * as areas of 64, 849, 64 and 1024: the -1 nearly the largest mark and the 0
 * the smallest. Dropping the channel costs a third dimension; drawing it that
 * way keeps the dimension and inverts it.
 */
function sizesAsArea(column: string, data: QueryResultData): boolean {
  if (!data.columns.some((c) => c.name === column)) return false
  // Number() rather than typeof: a ClickHouse Decimal arrives as a string, and
  // null, undefined and unparseable text all fail this comparison rather than
  // passing it, so they stay recharts' problem (it draws them at the floor).
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

  // inferYColumns is the shared rule (the chart editor seeds its mapping from
  // the same one). A column explicitly mapped to yRight or to size is dropped
  // on top of it: it is already claimed by that slot, and leaving it in would
  // draw and count the same column twice. A bubble's size column is the one
  // that bites, because a chart may map x and size and leave y to inference,
  // and the size column is numeric: without this it would be plotted as an
  // ordinary y series as well as sizing every point. The editor's inference
  // never sees either mapping, so the exclusion belongs here rather than
  // inside the helper.
  //
  // Keyed off the MAPPED name, not the drawable one. The slot claims the column
  // either way, so a size column this chart declined to draw stays out of the y
  // axis instead of reappearing there as a series nobody asked for, which would
  // turn one silently missing channel into one silently invented one.
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

  // "Is this chart actually indexed" is decided in exactly one place
  // (effectiveIndexed above), shared with the chart editor's checkbox, so the
  // two can never drift apart again.
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
// Null gets a readable label rather than the string 'null', and an empty
// string joins it: its own '' key would collide with the renderer's
// anonymous no-series-column group, whose `name || xCol` fallback reroutes
// the color lookup to the x column's name, so nothing stored under '' is
// ever read. The rule lives here so the editor's per-series section derives
// exactly the names the renderer will look up in seriesOptions.
export const UNGROUPED_SERIES_LABEL = 'Ungrouped'

export function scatterSeriesKey(value: unknown): string {
  return value == null || value === '' ? UNGROUPED_SERIES_LABEL : String(value)
}

// A right-axis column's name a drawn series in chartData actually carries.
// With no series column, a right-axis column already has one unambiguous
// value per x, so it renders under its own column name and this returns
// config.yRightCols unchanged. Once a series column pivots the same x into
// one row per series, though, a right-axis column no longer has a single
// value at that x: every row sharing that x (one per series value) can carry
// a different value for it, so there is no honest single series left to draw
// under the bare column name. This resolves one named series per (right
// column, series value) pair instead, so a drawn line always traces back to
// that pair's own rows rather than to whichever row happened to be written
// last into a shared slot.
//
// Shared by buildChartData's pivot (which must build exactly these keys),
// both renderers that draw right-axis series (line/area, and bar's
// horizontal layout), the table twin, and indexSeries, so "what is this
// chart's right-axis series really called" is decided in exactly one place.
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
