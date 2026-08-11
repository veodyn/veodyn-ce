// Shared `validate` helpers: almost every visualization fails the same way,
// by naming a column the query no longer returns.
//
// This is not hypothetical. A stage query charted a `capacity` column its data
// source had stopped returning; the chart drew axes, no bars, and no error.
// Nothing in the app or the test suite noticed, because a renderer handed a
// missing column produces an empty series rather than throwing.
import type { QueryResultData } from '@/lib/mock-data'

/**
 * Roles a columnMapping value can take. Anything else is not a column slot.
 *
 * Kept honest against the renderers that read the mapping, in both directions.
 * A role missing here means a genuinely broken visualization stays silent
 * (`source` and `target` were missing, so a Sankey whose source column
 * disappeared said nothing). A role here that no renderer reads means a false
 * warning about a column the visualization already ignores.
 *
 * `size` has been on both sides of that. It was taken out while no renderer
 * read it, and it is back because ScatterChart does now: it binds a bubble's
 * size column to a recharts ZAxis, so a stale one is no longer ignored, it
 * silently costs the chart its third dimension. Every point falls back to one
 * uniform mark and the result is a plain scatter under a bubble's name, which
 * is the same shape of bug as the `capacity` chart above.
 *
 * Readers: chart, heatmap and box plot use x / y / yRight / series; chart's
 * scatter shape also uses size (see chart/resolve-config.ts);
 * sankey-renderer.tsx uses source / target / value; box plot uses category.
 */
const MAPPING_ROLES = new Set([
  'x',
  'y',
  'yRight',
  'series',
  'size',
  'category',
  'value',
  'source',
  'target',
])

function columnNames(data: QueryResultData): Set<string> {
  return new Set(data.columns.map((column) => column.name))
}

/**
 * Problems for option keys that each hold a single column name.
 *
 * An unset key is not a problem here. "You have not finished configuring this"
 * is a different message from "this names something that does not exist", and
 * reporting the first as an error would light up every freshly created
 * visualization.
 */
export function missingNamedColumns(
  options: Record<string, unknown>,
  keys: readonly { key: string; label: string }[],
  data: QueryResultData
): string[] {
  const names = columnNames(data)
  const problems: string[] = []
  for (const { key, label } of keys) {
    const value = options[key]
    if (typeof value !== 'string' || value === '') continue
    if (!names.has(value)) {
      problems.push(`The ${label} column "${value}" is not in this query result.`)
    }
  }
  return problems
}

/**
 * Problems for a Redash `columnMapping`, whose keys are column names and whose
 * values are roles.
 *
 * Only entries carrying a real role are checked: the editors write
 * `'-- unused --'` style values to mean "ignore this column", and a column
 * parked that way is allowed to be stale.
 */
export function missingMappedColumns(
  options: Record<string, unknown>,
  data: QueryResultData
): string[] {
  const mapping = options.columnMapping
  if (mapping == null || typeof mapping !== 'object') return []
  const names = columnNames(data)
  const problems: string[] = []
  for (const [column, role] of Object.entries(mapping as Record<string, unknown>)) {
    if (typeof role !== 'string' || !MAPPING_ROLES.has(role)) continue
    if (!names.has(column)) {
      problems.push(`The ${role} column "${column}" is not in this query result.`)
    }
  }
  return problems
}
