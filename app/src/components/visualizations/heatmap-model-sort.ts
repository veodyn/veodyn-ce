import type { RedashHeatmapOptions } from '@/services/redash/types'
import { cellKey } from './heatmap-cell-key'

// Row ordering, split out of heatmap-model.ts once the cell-identity and
// value-validity fixes pushed that file past the project's file-size limit.
// The seam is real and already existed in the tests (heatmap-model-sort.test.ts
// has been its own file since Task 6): nothing in here builds a model, and
// nothing left in heatmap-model.ts compares two rows.

// The sum and the single largest cell in one row, computed over the x axis so
// a missing (x, y) combination counts as absent rather than as a zero: a row
// with three cells at 10 and a row with three cells at 10 plus five empty
// combinations are the same row as far as "how big is this row" goes, and
// treating the gaps as zeros would rank the second one lower for having more
// columns it never appeared in.
//
// A row with no cells at all reaches here two ways: by calling sortYCategories
// directly (which its own test does), and, since the value-validity fix, out
// of buildHeatmapModel itself, when every row behind a y category carried an
// unusable value and so wrote no cell. NEGATIVE_INFINITY, rather than 0, is
// what sinks such a row to the bottom whatever sign the real rows carry, which
// "0 means empty" would get wrong for a grid of negatives.
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
// the rows worth looking at belong at the top.
//
// 'total' and 'peak' genuinely disagree, which is the whole reason both exist.
// A row that is moderately busy in every column outranks a row that is quiet
// except for one spike under 'total', and the two swap under 'peak'. A test
// whose fixture makes them agree cannot tell either implementation from the
// other.
//
// Sorts a copy, and Array.prototype.sort is stable (required by the language
// since ES2019), so rows of equal rank keep the order they first appeared in
// the query result rather than being shuffled arbitrarily. Deliberately no
// secondary key: falling back to alphabetical on a tie reads like a tidy-up
// and is not one, since it would reorder rows the author's own query put in a
// meaningful order (a time axis, most obviously) for no reason a reader can
// see.
//
// The `left === right` arm returns 0 rather than subtracting: for two
// NEGATIVE_INFINITY ranks the subtraction is NaN, which the language then
// coerces back to +0 anyway (ECMA-262 SortCompare), so this is written for
// legibility and not because the two behave differently.
export function sortYCategories(
  yCategories: string[],
  xCategories: string[],
  cells: Map<string, number>,
  sortRows: RedashHeatmapOptions['sortRows']
): string[] {
  if (sortRows !== 'total' && sortRows !== 'peak') return yCategories
  // Ranked once per row up front rather than inside the comparator, which a
  // sort calls O(n log n) times per row and would otherwise re-walk the whole
  // x axis for on every one of those calls.
  const ranks = new Map(yCategories.map((y) => [y, rowRank(y, xCategories, cells)[sortRows]]))
  const rankOf = (y: string) => ranks.get(y) ?? Number.NEGATIVE_INFINITY
  return [...yCategories].sort((a, b) => {
    const left = rankOf(a)
    const right = rankOf(b)
    return left === right ? 0 : right - left
  })
}
