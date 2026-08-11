/**
 * Redash's result-filter convention.
 *
 * A query author opts a column into a filter control by naming it
 * `route_id::filter` (also `__filter`, and the `multi-filter` / `multiFilter`
 * variants for several values at once). The suffix is an instruction, not data,
 * so it has to come off before the column is shown anywhere.
 *
 * Mirrors query-result.js: filterTypes, getColumnNameWithoutType, getFilters.
 */
import type { QueryResultData } from '@/lib/mock-data'

const FILTER_TYPES = ['filter', 'multi-filter', 'multiFilter']
const MULTI_TYPES = ['multi-filter', 'multiFilter']

/** The suffix a column name carries, or null when it is an ordinary column. */
function filterTypeOf(name: string): string | null {
  const separator = name.includes('::') ? '::' : name.includes('__') ? '__' : null
  if (!separator) return null

  const parts = name.split(separator)
  const type = parts[1]
  return type && FILTER_TYPES.includes(type) ? type : null
}

/**
 * What to show instead of the raw column name. A column that merely contains
 * the separator keeps its name: renaming it would misreport the data.
 */
export function columnDisplayName(name: string): string {
  return filterTypeOf(name) ? name.split(name.includes('::') ? '::' : '__')[0] : name
}

/**
 * Columns with the filter suffix taken off the label. `name` is left alone: it
 * is the key every row is indexed by, so rewriting it would detach the header
 * from its data. A friendly name the runner already supplied wins, since it
 * knows more than a suffix strip does.
 */
export function displayColumns<T extends { name: string; friendly_name: string }>(
  columns: T[]
): T[] {
  return columns.map((column) =>
    column.friendly_name === column.name
      ? { ...column, friendly_name: columnDisplayName(column.name) }
      : column
  )
}

export interface ResultFilter {
  /** The raw column name, which is the key in every row. */
  name: string
  /** What to label the control with. */
  friendlyName: string
  multiple: boolean
  values: string[]
}

export function detectResultFilters(data: QueryResultData): ResultFilter[] {
  const filters: ResultFilter[] = []

  for (const column of data.columns) {
    const type = filterTypeOf(column.name)
    if (!type) continue

    const seen = new Set<string>()
    for (const row of data.rows) {
      const value = row[column.name]
      if (value != null) seen.add(String(value))
    }

    filters.push({
      name: column.name,
      friendlyName: columnDisplayName(column.name),
      multiple: MULTI_TYPES.includes(type),
      values: [...seen],
    })
  }

  return filters
}

/**
 * Rows matching every active selection. An empty or absent selection for a
 * column means that column is not filtering, rather than matching nothing.
 */
export function applyResultFilters(
  data: QueryResultData,
  selections: Record<string, string[]>
): QueryResultData {
  const active = Object.entries(selections).filter(([, values]) => values.length > 0)
  if (active.length === 0) return data

  return {
    // Untouched: filtering is about rows, and rebuilding the column list here
    // would drop whatever the caller had already resolved onto it.
    columns: data.columns,
    rows: data.rows.filter((row) =>
      active.every(([name, values]) => values.includes(String(row[name])))
    ),
  }
}
