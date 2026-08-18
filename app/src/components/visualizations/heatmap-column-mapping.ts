// Which columns a heatmap should read, written out as a mapping. resolveColumns
// in heatmap-model.ts already falls back positionally, so this is the creation
// side, for the two cases fallback cannot serve: an AI-authored widget, whose
// options say nothing about which columns the picture is of, and the edit
// dialog, which shows the mapping it is about to save.
import type { QueryResultData } from '@/lib/mock-data'

const NUMERIC_TYPES = new Set(['integer', 'float', 'decimal'])

/**
 * Axes first, then the measure, rather than position: the axes are the
 * non-numeric columns and the measure is the first numeric column left over.
 * Position gets a numeric grouping column wrong, colouring
 * `SELECT hour, name, avg(bikes)` by time of day.
 */
export function inferHeatmapColumnMapping(data: QueryResultData): Record<string, 'x' | 'y' | 'value'> {
  const chosen = new Set(data.columns.filter((column) => !NUMERIC_TYPES.has(column.type)).slice(0, 2))
  for (const column of data.columns) {
    if (chosen.size >= 2) break
    chosen.add(column)
  }
  // Back into the order the query returned them, so x is the column the SELECT
  // put first. Picking the axes non-numeric-first would put the grid on its side.
  const axes = data.columns.filter((column) => chosen.has(column))
  const value = data.columns.find((column) => !chosen.has(column) && NUMERIC_TYPES.has(column.type))
  // Half a mapping is worse than none, the rule inferChartColumnMapping follows:
  // an x with no y replaces the positional fallback without standing in for it.
  if (axes.length < 2 || value == null) return {}
  return { [axes[0].name]: 'x', [axes[1].name]: 'y', [value.name]: 'value' }
}
