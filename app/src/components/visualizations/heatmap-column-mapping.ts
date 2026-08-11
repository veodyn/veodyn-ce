// Which columns a heatmap should read, written out as a mapping.
//
// resolveColumns in heatmap-model.ts already falls back positionally (x is
// column 0, y is column 1, value is the first remaining numeric), so a heatmap
// with no mapping draws. This exists for the two cases that fallback cannot
// serve:
//
//   - An AI-authored widget, whose visualization is created before anyone opens
//     an editor. Nothing in its saved options says which columns the picture is
//     of, so the axes are whatever order the SELECT happened to use.
//   - The edit dialog, which shows the mapping it is about to save. An empty
//     mapping there reads as unconfigured even though the preview beside it is
//     drawing.
//
// A separate module from heatmap-model.ts because that file is at its size
// limit, and because this is the creation side: the model resolves what is
// saved, this proposes what to save.
import type { QueryResultData } from '@/lib/mock-data'

const NUMERIC_TYPES = new Set(['integer', 'float', 'decimal'])

/**
 * Axes first, then the measure, rather than position.
 *
 * A heatmap's query is `GROUP BY a, b` with one aggregate, and its grouping
 * columns are the ones a reader recognizes: a station name, a day, a corridor.
 * Those are the non-numeric columns, so they are taken as the axes and the
 * measure is the first numeric column left over. That agrees with the positional
 * fallback wherever the fallback is already right, including a result carrying
 * two measures, where `avg` before `max` means `avg` is the one to colour by.
 *
 * The case position gets wrong is a numeric grouping column: `SELECT hour, name,
 * avg(bikes)` has an integer hour, and "the first numeric column is the measure"
 * would colour the grid by time of day. Filling the axes from the leading
 * columns when there are not two non-numeric ones keeps that result a heatmap of
 * bikes rather than a heatmap of clocks.
 */
export function inferHeatmapColumnMapping(data: QueryResultData): Record<string, 'x' | 'y' | 'value'> {
  const chosen = new Set(data.columns.filter((column) => !NUMERIC_TYPES.has(column.type)).slice(0, 2))
  for (const column of data.columns) {
    if (chosen.size >= 2) break
    chosen.add(column)
  }
  // Back into the order the query returned them, so x is the column the SELECT
  // put first. Picking the axes non-numeric-first would otherwise reorder them:
  // `SELECT hour, name, avg(bikes)` would put the stations across the x axis and
  // the 24 hours down the y, which is the grid on its side.
  const axes = data.columns.filter((column) => chosen.has(column))
  const value = data.columns.find((column) => !chosen.has(column) && NUMERIC_TYPES.has(column.type))
  // Half a mapping is worse than none, the same rule inferChartColumnMapping
  // follows: an x with no y replaces the positional fallback without standing
  // in for it, and buildHeatmapModel's guard then draws nothing at all.
  if (axes.length < 2 || value == null) return {}
  return { [axes[0].name]: 'x', [axes[1].name]: 'y', [value.name]: 'value' }
}
