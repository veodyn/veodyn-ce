import type { QueryResultData } from '@/lib/mock-data'
import type { RedashHeatmapOptions } from '@/services/redash/types'
import { formatExactNumber } from '@/lib/chart-format'
import { cellKey } from './heatmap-cell-key'
import { sortYCategories } from './heatmap-model-sort'

const NUMERIC_TYPES = new Set(['integer', 'float', 'decimal'])

// Above this many cells (xCategories.length * yCategories.length, the size of
// the grid itself, not how many of those cells are populated), 'auto' stops
// printing a value in every cell. The number comes from the screenshot that
// prompted this work: a 360-cell grid with every cell numbered read as noise,
// not data. 150 is the largest grid that still reads as a table of numbers
// rather than a wall of them.
export const HEATMAP_VALUE_DENSITY_THRESHOLD = 150

// The domain clip points, in percent. A single extreme cell otherwise owns
// the top (or bottom) of the colour ramp and compresses every ordinary row
// into a sliver at the other end, which is the exact failure this task exists
// to remove.
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
  // The value column's own friendly_name (falling back to its name, then to
  // 'Count' for a count aggregation with no value column at all). Resolved
  // here, once, so the renderer and the legend read it off the model instead
  // of re-deriving the column resolution a second time.
  valueLabel: string
  // The x and y columns' own friendly_names, resolved the same way and for
  // the same reason: the renderer prints them as axis titles beside the grid,
  // and a grid whose columns are hours and whose rows are stations says
  // neither of those anywhere otherwise.
  xLabel: string
  yLabel: string
}

// What one cell has accumulated so far. `rows` counts every row that landed
// here; `valid` counts only the ones that carried a usable number, and is what
// avg divides by. The two differ exactly when the value column has holes in
// it, which is the whole point of tracking both.
interface CellAccumulator {
  sum: number
  valid: number
  rows: number
  min: number
  max: number
}

// One row's contribution, or null when the row carries no usable number in the
// value column.
//
// Deliberately not `Number(raw) || 0`, which is what this was: a null, an
// undefined, an empty string and a non-numeric string all became a real 0
// observation, so a cell holding 10 and a null averaged to 5, its min was 0,
// and those invented zeros moved the colour domain and the percentile clip
// points. Deliberately not `Number.isFinite(Number(raw))` either: Number(null),
// Number(''), Number('  ') and Number(false) are every one of them a finite 0,
// so coercing first and checking after still fabricates zeros out of four
// different kinds of missing data.
//
// Nothing here tests truthiness, because a genuine 0 IS an observation: it has
// to keep counting toward avg, min, max and the colour domain like any other
// number. A numeric string is accepted, since a result set handing numbers back
// as strings is ordinary and rejecting those would be the same class of lie in
// the other direction (data present, model says otherwise).
function observationOf(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string') {
    if (raw.trim() === '') return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

// The cell's single value, or null when it has nothing to say and so must not
// appear in the map at all. 'count' answers "how many rows landed here", which
// consults no value column, so it is never null. Every other aggregation needs
// at least one valid observation; a cell with none is absent, not zero, and
// the renderer already draws an absent cell blank.
function finalizeCell(cell: CellAccumulator, aggregation: RedashHeatmapOptions['aggregation']): number | null {
  if (aggregation === 'count') return cell.rows
  if (cell.valid === 0) return null
  if (aggregation === 'avg') return cell.sum / cell.valid
  if (aggregation === 'min') return cell.min
  if (aggregation === 'max') return cell.max
  return cell.sum
}

// Resolves which data columns feed x, y and value: an explicit columnMapping
// entry wins, otherwise x falls back to the first column, y to the second,
// and value to the first remaining numeric column.
//
// An explicit mapping naming a column that is NOT in data.columns (a query
// edited so the mapped column was renamed or dropped) resolves to undefined,
// and deliberately does not fall through to the positional fallback: drawing
// the chart on different columns than the author chose is as quiet a lie as
// the one this replaced, where row[xCol] was undefined, String(undefined) was
// the literal 'undefined', and every row collapsed into one category by that
// name. undefined flows into buildHeatmapModel's required-columns guard, so
// the renderer shows its existing empty state.
//
// Only a mapping that is present AND stale becomes undefined. The positional
// fallbacks are for the UNMAPPED case and are untouched.
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

// Linear interpolation between the two nearest ranks (the method NumPy's
// default 'linear' and Excel's PERCENTILE.INC use), not nearest-rank.
// Nearest-rank snaps the clip point to one of the actual data values, so it
// can jump discontinuously as the cell count changes by one; interpolating
// moves the clip point smoothly as the underlying data changes, which is what
// "the 2nd percentile" is generally taken to mean. `sorted` must already be
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

// Builds the heatmap's data model: category axes, the aggregated cell map,
// and the colour domain. Pure, no React and no DOM, so it can be tested and
// reused anywhere the renderer needs it. Returns null when the required x, y
// (and, unless the aggregation is 'count', value) columns cannot be
// resolved, matching the renderer's existing empty state.
//
// A category is created by any row naming it, whether or not that row carried
// a usable value, so an axis lists what the query actually returned. A CELL is
// only created by a row with something to say, so a row (or column) whose every
// value was unusable stays on its axis and renders blank.
//
// min/max mirror rawMin/rawMax unless options.clipOutliers is set AND
// clipping actually narrows the domain (min/max never widen it back out past
// the raw extremes). clipped is only true when the domain the legend and the
// colour scale actually use differs from the raw one: announcing a clip that
// made no difference would be its own small lie about the chart's range.
// Clipping never removes or rewrites a cell's value in `cells`; only the
// colour domain (min/max) narrows, so an out-of-domain cell still renders,
// clamped to the endpoint colour by getSequentialScale/getSequentialInk's
// own clamping (see chart-colors.ts's normalize()), not hidden and not
// recoloured as though it were inside the range.
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
  // Two terms, not the three valueLabel above uses: a `?? column.name` in the
  // middle would be dead code here, since the column is FOUND by matching that
  // same name, so it can only ever equal xCol/yCol. xCol/yCol are non-empty by
  // the guard at the top of this function, so they are a real last resort: a
  // column the result set carries no descriptor for at all, or one whose
  // friendly_name came back empty, still has a name worth printing on the axis.
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

// Whether the renderer should print a number in each cell. 'always' and
// 'never' are unconditional; 'auto' (also the undefined/default case) draws
// the line at HEATMAP_VALUE_DENSITY_THRESHOLD, inclusive, so a grid of
// exactly that many cells still shows its values and the next size up does
// not.
export function shouldShowValues(showValues: RedashHeatmapOptions['showValues'], cellCount: number): boolean {
  if (showValues === 'always') return true
  if (showValues === 'never') return false
  return cellCount <= HEATMAP_VALUE_DENSITY_THRESHOLD
}

// The one description string a cell's accessible name, its floating tooltip,
// and (for a screen reader) the only surviving record of its value on a
// dense grid all have to agree on. Defined once here, not duplicated between
// heatmap-cell.tsx (the per-cell aria-label) and heatmap-renderer.tsx (the
// portaled tooltip content), so the two can never drift apart. Uses
// formatExactNumber, not formatCompactNumber: this is the exact value, the
// whole reason this function exists.
export function describeHeatmapCell(x: string, y: string, value: number | undefined): string {
  return value != null ? `${x} / ${y}: ${formatExactNumber(value)}` : `${x} / ${y}: no data`
}
