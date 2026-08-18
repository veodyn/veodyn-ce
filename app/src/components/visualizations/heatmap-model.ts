import type { QueryResultData } from '@/lib/mock-data'
import type { RedashHeatmapOptions } from '@/services/redash/types'
import { formatExactNumber } from '@/lib/chart-format'
import { cellKey } from './heatmap-cell-key'
import { sortYCategories } from './heatmap-model-sort'

const NUMERIC_TYPES = new Set(['integer', 'float', 'decimal'])

// Above this many cells (xCategories.length * yCategories.length, the grid's
// size, not how many cells are populated), 'auto' stops printing a value in
// every cell. 150 is the largest grid that still reads as a table of numbers.
export const HEATMAP_VALUE_DENSITY_THRESHOLD = 150

// The domain clip points, in percent. Without them a single extreme cell owns
// one end of the colour ramp and compresses every ordinary row into a sliver.
export const CLIP_LOWER_PERCENTILE = 2
export const CLIP_UPPER_PERCENTILE = 98

export interface HeatmapCell {
  x: string
  y: string
  value: number
}

export interface HeatmapModel {
  xCategories: string[]
  yCategories: string[]
  cells: Map<string, number>
  min: number
  max: number
  rawMin: number
  rawMax: number
  clipped: boolean
  cellCount: number
  // The value column's friendly_name, falling back to its name, then to
  // 'Count' for a count aggregation with no value column at all.
  valueLabel: string
  // The x and y columns' friendly_names, which the renderer prints as the
  // axis titles beside the grid.
  xLabel: string
  yLabel: string
}

// `rows` counts every row that landed here; `valid` counts only those carrying
// a usable number, and is what avg divides by.
interface CellAccumulator {
  sum: number
  valid: number
  rows: number
  min: number
  max: number
}

// One row's contribution, or null when the row carries no usable number in the
// value column. Missing data must not coerce to 0: Number(null), Number(''),
// Number('  ') and Number(false) are all a finite 0, and an invented 0 moves
// avg, min, max, the colour domain and the percentile clip points. A genuine 0
// is a real observation, and a numeric string is accepted.
function observationOf(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string') {
    if (raw.trim() === '') return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

// The cell's single value, or null when it must not appear in the map at all.
// 'count' consults no value column, so it is never null. Every other
// aggregation needs one valid observation: a cell with none is absent, not
// zero, and the renderer draws an absent cell blank.
function finalizeCell(cell: CellAccumulator, aggregation: RedashHeatmapOptions['aggregation']): number | null {
  if (aggregation === 'count') return cell.rows
  if (cell.valid === 0) return null
  if (aggregation === 'avg') return cell.sum / cell.valid
  if (aggregation === 'min') return cell.min
  if (aggregation === 'max') return cell.max
  return cell.sum
}

// Which data columns feed x, y and value: an explicit columnMapping entry
// wins, otherwise x falls back to the first column, y to the second, and value
// to the first remaining numeric column. A mapping naming a column the result
// no longer carries resolves to undefined rather than falling through to the
// positional fallback, and buildHeatmapModel's guard then renders the empty
// state.
export function resolveColumns(options: RedashHeatmapOptions, data: QueryResultData) {
  const columnMapping = options.columnMapping ?? {}
  const known = new Set(data.columns.map((c) => c.name))
  const mapped = (role: string) => Object.entries(columnMapping).find(([, v]) => v === role)?.[0]
  const resolve = (role: string, fallback: () => string | undefined) => {
    const name = mapped(role)
    if (name === undefined) return fallback()
    return known.has(name) ? name : undefined
  }
  const xCol = resolve('x', () => data.columns[0]?.name)
  const yCol = resolve('y', () => data.columns[1]?.name)
  const valueCol = resolve(
    'value',
    () => data.columns.find((c) => c.name !== xCol && c.name !== yCol && NUMERIC_TYPES.has(c.type))?.name
  )
  return { xCol, yCol, valueCol }
}

// Linear interpolation between the two nearest ranks (NumPy's default
// 'linear', Excel's PERCENTILE.INC), not nearest-rank, which jumps
// discontinuously as the cell count changes by one. `sorted` must already be
// sorted ascending.
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const rank = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(rank)
  const upper = Math.ceil(rank)
  if (lower === upper) return sorted[lower]
  const weight = rank - lower
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight
}

// The heatmap's data model: category axes, the aggregated cell map, and the
// colour domain. Returns null when the required x, y (and, unless the
// aggregation is 'count', value) columns cannot be resolved.
//
// A category is created by any row naming it; a CELL only by a row carrying a
// usable value, so a row whose values were all unusable stays on its axis and
// renders blank.
//
// min/max mirror rawMin/rawMax unless clipOutliers is set and clipping
// actually narrows the domain, and `clipped` reports only that narrowing case.
// Clipping never rewrites a cell's value: an out-of-domain cell still renders,
// clamped to the endpoint colour by chart-colors.ts's normalize().
export function buildHeatmapModel(options: RedashHeatmapOptions, data: QueryResultData): HeatmapModel | null {
  const aggregation = options.aggregation ?? 'sum'
  const { xCol, yCol, valueCol } = resolveColumns(options, data)

  if (!xCol || !yCol || (!valueCol && aggregation !== 'count')) {
    return null
  }

  const xSet = new Set<string>()
  const ySet = new Set<string>()
  const acc = new Map<string, CellAccumulator>()

  for (const row of data.rows) {
    const x = String(row[xCol])
    const y = String(row[yCol])
    xSet.add(x)
    ySet.add(y)
    const key = cellKey(x, y)
    const cell = acc.get(key) ?? { sum: 0, valid: 0, rows: 0, min: Infinity, max: -Infinity }
    cell.rows += 1
    const value = aggregation === 'count' ? null : observationOf(row[valueCol as string])
    if (value !== null) {
      cell.sum += value
      cell.valid += 1
      cell.min = Math.min(cell.min, value)
      cell.max = Math.max(cell.max, value)
    }
    acc.set(key, cell)
  }

  const cells = new Map<string, number>()
  let minVal = Infinity
  let maxVal = -Infinity
  for (const [key, cell] of acc) {
    const finalized = finalizeCell(cell, aggregation)
    if (finalized === null) continue
    cells.set(key, finalized)
    if (finalized < minVal) minVal = finalized
    if (finalized > maxVal) maxVal = finalized
  }

  const rawMin = Number.isFinite(minVal) ? minVal : 0
  const rawMax = Number.isFinite(maxVal) ? maxVal : 0
  const xCategories = Array.from(xSet)
  // Insertion order is the 'none' default, so a saved heatmap authored before
  // sortRows existed keeps the exact row order it has always had.
  const yCategories = sortYCategories(Array.from(ySet), xCategories, cells, options.sortRows)

  let min = rawMin
  let max = rawMax
  let clipped = false
  if (options.clipOutliers && cells.size > 0) {
    const sorted = Array.from(cells.values()).sort((a, b) => a - b)
    const clippedMin = percentile(sorted, CLIP_LOWER_PERCENTILE)
    const clippedMax = percentile(sorted, CLIP_UPPER_PERCENTILE)
    if (clippedMin > rawMin || clippedMax < rawMax) {
      min = clippedMin
      max = clippedMax
      clipped = true
    }
  }

  const valueColumn = data.columns.find((c) => c.name === valueCol)
  const valueLabel = valueColumn?.friendly_name || valueColumn?.name || 'Count'
  // Two terms, not the three valueLabel uses: the column is found by matching
  // xCol/yCol, so a `?? column.name` in the middle would be dead code.
  const xColumn = data.columns.find((c) => c.name === xCol)
  const yColumn = data.columns.find((c) => c.name === yCol)
  const xLabel = xColumn?.friendly_name || xCol
  const yLabel = yColumn?.friendly_name || yCol

  return {
    xCategories,
    yCategories,
    cells,
    min,
    max,
    rawMin,
    rawMax,
    clipped,
    cellCount: xCategories.length * yCategories.length,
    valueLabel,
    xLabel,
    yLabel,
  }
}

// Whether the renderer should print a number in each cell. 'auto' (also the
// default) draws the line at HEATMAP_VALUE_DENSITY_THRESHOLD, inclusive.
export function shouldShowValues(showValues: RedashHeatmapOptions['showValues'], cellCount: number): boolean {
  if (showValues === 'always') return true
  if (showValues === 'never') return false
  return cellCount <= HEATMAP_VALUE_DENSITY_THRESHOLD
}

// The one string heatmap-cell.tsx's aria-label and heatmap-renderer.tsx's
// portaled tooltip both read, so the two cannot drift. formatExactNumber, not
// formatCompactNumber: on a dense grid this is the only record of the value.
export function describeHeatmapCell(x: string, y: string, value: number | undefined): string {
  return value != null ? `${x} / ${y}: ${formatExactNumber(value)}` : `${x} / ${y}: no data`
}
