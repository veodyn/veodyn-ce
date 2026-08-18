import type { RedashHeatmapOptions } from '@/services/redash/types'
import { cellKey } from './heatmap-cell-key'

// The sum and the single largest cell in one row, computed over the x axis so a
// missing (x, y) combination counts as absent rather than as a zero: two rows
// with the same three cells rank the same however many columns they never
// appeared in.
//
// A row can carry no cells at all, when every row behind a y category held an
// unusable value. NEGATIVE_INFINITY, not 0, is what sinks it to the bottom
// whatever sign the real rows carry.
function rowRank(y: string, xCategories: string[], cells: Map<string, number>): { total: number; peak: number } {
  let total = 0
  let peak = Number.NEGATIVE_INFINITY
  let seen = 0
  for (const x of xCategories) {
    const value = cells.get(cellKey(x, y))
    if (value == null) continue
    seen += 1
    total += value
    if (value > peak) peak = value
  }
  if (seen === 0) return { total: Number.NEGATIVE_INFINITY, peak: Number.NEGATIVE_INFINITY }
  return { total, peak }
}

// Row order. Descending in both ranked modes: a heatmap is read top-down, so
// the rows worth looking at belong at the top. 'total' and 'peak' disagree by
// design, a row busy in every column outranking one quiet except for a spike
// under 'total' and losing to it under 'peak'.
//
// Sorts a copy, and Array.prototype.sort is stable (required since ES2019), so
// rows of equal rank keep the order they first appeared in the query result.
// No secondary key: an alphabetical tiebreak would reorder rows the author's
// query put in a meaningful order.
//
// The `left === right` arm returns 0 for legibility: two NEGATIVE_INFINITY ranks
// subtract to NaN, which ECMA-262 SortCompare coerces back to +0 anyway.
export function sortYCategories(
  yCategories: string[],
  xCategories: string[],
  cells: Map<string, number>,
  sortRows: RedashHeatmapOptions['sortRows']
): string[] {
  if (sortRows !== 'total' && sortRows !== 'peak') return yCategories
  // Ranked once per row up front: inside the comparator this would re-walk the
  // whole x axis on each of the sort's O(n log n) calls.
  const ranks = new Map(yCategories.map((y) => [y, rowRank(y, xCategories, cells)[sortRows]]))
  const rankOf = (y: string) => ranks.get(y) ?? Number.NEGATIVE_INFINITY
  return [...yCategories].sort((a, b) => {
    const left = rankOf(a)
    const right = rankOf(b)
    return left === right ? 0 : right - left
  })
}
