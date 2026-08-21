// Shared `validate` helpers: almost every visualization fails the same way, by
// naming a column the query no longer returns. A renderer handed a missing
// column draws an empty series rather than throwing, so nothing else notices.
import type { QueryResultData } from '@/lib/mock-data'

/**
 * Roles a columnMapping value can take. Anything else is not a column slot.
 * Keep this in step with the renderers in both directions: a missing role lets
 * a broken visualization stay silent, an unread one warns about a column
 * nothing uses.
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
 * One option key holding a column name. `appliesTo` gates the check on the rest
 * of the options, for a key only one of a type's modes reads: an option the
 * renderer will never look at cannot be stale in a way the analyst can fix.
 */
export interface NamedColumn {
  key: string
  label: string
  appliesTo?: (options: Record<string, unknown>) => boolean
}

/**
 * Problems for option keys that each hold a single column name. An unset key is
 * not a problem: unfinished configuration is a different message from a name
 * that does not exist.
 */
export function missingNamedColumns(
  options: Record<string, unknown>,
  keys: readonly NamedColumn[],
  data: QueryResultData
): string[] {
  const names = columnNames(data)
  const problems: string[] = []
  for (const { key, label, appliesTo } of keys) {
    if (appliesTo && !appliesTo(options)) continue
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
