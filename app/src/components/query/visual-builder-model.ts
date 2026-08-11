// The pure half of the Visual builder: option lists, spec edits, and the guarded
// call into the deterministic compiler. No React, no model call. Keeping it here
// means the component file stays a layout and the composition rules are testable
// through the component without mocking anything.
import { isAppError } from '@/lib/errorIds'
import { isDateOnlySqlType, isDateSqlType, isNumericSqlType } from '@/lib/sql-safety'
import { compileVisualQuery } from '@/lib/visual-query'
import { DEFAULT_VIZ_ID } from '@/lib/viz-choices'
import type {
  AiDatasetColumn,
  VisualAggFn,
  VisualAggregate,
  VisualFilter,
  VisualQuerySpec,
  VisualSort,
} from '@/types/ai'

export interface Option {
  label: string
  value: string
}

export const AGGREGATE_FNS: VisualAggFn[] = ['sum', 'avg', 'count', 'min', 'max']
export const FILTER_OPS: VisualFilter['op'][] = ['=', '!=', '>', '>=', '<', '<=', 'like']
export const SORT_DIRECTIONS: Option[] = [
  { label: 'Ascending', value: 'asc' },
  { label: 'Descending', value: 'desc' },
]
export const DEFAULT_LIMIT = 100
export { DEFAULT_VIZ_ID }

/**
 * Everything the field picker holds: the spec minus the dataset, which the pane
 * owns, plus the limit as typed rather than parsed.
 *
 * This lives outside the component because the analyst may leave Visual mode
 * for PRO and come back, and the picks have to still be there when they do.
 * The page keeps the draft; the builder unmounts and remounts around it.
 */
export interface VisualDraft {
  dimensions: string[]
  aggregates: VisualAggregate[]
  filters: VisualFilter[]
  sort: VisualSort[]
  limit: string
  /** A viz choice id (see `viz-choices`), not a Redash visualization type. */
  vizId: string
}

export function emptyVisualDraft(): VisualDraft {
  return {
    dimensions: [],
    aggregates: [],
    filters: [],
    sort: [],
    limit: String(DEFAULT_LIMIT),
    vizId: DEFAULT_VIZ_ID,
  }
}

export function toOptions(values: readonly string[]): Option[] {
  return values.map((value) => ({ label: value, value }))
}

// The catalog identifies a dataset by slug and SQL needs an identifier, so the
// one transformation is hyphen to underscore. Anything else is left as it is:
// compileVisualQuery refuses it and the builder shows why, rather than this
// helper quietly inventing a table name that does not exist.
export function datasetTableName(datasetId: string): string {
  return typeof datasetId === 'string' ? datasetId.replace(/-/g, '_') : ''
}

/**
 * The input type a filter on this column should use: a date column gets a date
 * picker, so the value is a shape the database can parse rather than whatever
 * was typed. `datetime-local` is deliberately not used for a plain date column,
 * which has no time to fill in.
 *
 * Anything else stays free text: `text`, not `number` even for a numeric
 * column, because a number input swallows what it cannot parse and the analyst
 * would watch their keystrokes vanish instead of reading why they were wrong.
 */
export function filterInputType(
  column: string,
  columns: readonly AiDatasetColumn[]
): 'text' | 'date' | 'datetime-local' {
  const type = columns.find((c) => c?.name === column)?.type
  if (type == null || !isDateSqlType(type)) return 'text'
  return isDateOnlySqlType(type) ? 'date' : 'datetime-local'
}

/** Non-numeric columns group; numeric ones aggregate (AI plan Task 4). */
export function dimensionColumns(columns: readonly AiDatasetColumn[]): AiDatasetColumn[] {
  return columns.filter((column) => !isNumericSqlType(column.type))
}

export function measureColumns(columns: readonly AiDatasetColumn[]): AiDatasetColumn[] {
  return columns.filter((column) => isNumericSqlType(column.type))
}

export function columnNames(columns: readonly AiDatasetColumn[]): string[] {
  return columns.map((column) => column.name)
}

// ORDER BY may name a selected dimension, an aggregate alias, or any schema
// column, which is exactly what compileVisualQuery accepts in that position.
export function sortOptions(
  dimensions: readonly string[],
  aggregates: readonly VisualAggregate[],
  columns: readonly AiDatasetColumn[]
): Option[] {
  const names = [...dimensions, ...aggregates.map((agg) => agg.alias), ...columnNames(columns)]
  return toOptions([...new Set(names)])
}

/** A unique, single-part identifier alias so two measures never collide. */
export function aliasFor(fn: VisualAggFn, column: string, taken: readonly string[]): string {
  const bare = column.split('.').pop() ?? column
  const base = `${fn}_${bare}`
  if (!taken.includes(base)) return base
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}_${suffix}`
    if (!taken.includes(candidate)) return candidate
  }
  return `${base}_${taken.length + 1}`
}

export function toggleMember(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

export function replaceAt<T>(list: readonly T[], index: number, next: T): T[] {
  return list.map((item, position) => (position === index ? next : item))
}

export function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, position) => position !== index)
}

// The limit input is type=number with min 0. An emptied field is "no limit"
// (zero), which keeps the preview compiling instead of flashing a validation
// error mid-edit. Otherwise only a plain non-negative integer is a limit:
// parseInt silently truncated "1e3" and "1.9" to 1 and ran a wrong LIMIT 1.
// A non-canonical entry (scientific, fractional, signed, hex) becomes NaN, a
// value the compiler refuses, so the builder shows why rather than running the
// wrong query.
export function parseLimit(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN
}

export interface CompiledQuery {
  sql: string | null
  error: string | null
}

// compileVisualQuery throws an AppError on a refused identifier, a refused
// value, or a cross-dataset spec. The builder is a live preview, so a throw is
// an expected state here: turn it into a message, never an unhandled crash.
export function compileSafely(
  spec: VisualQuerySpec,
  columns: readonly AiDatasetColumn[]
): CompiledQuery {
  try {
    return { sql: compileVisualQuery(spec, { columns }), error: null }
  } catch (error) {
    return {
      sql: null,
      error: isAppError(error)
        ? error.message
        : 'These fields cannot be turned into SQL. Adjust them, or continue in the SQL editor.',
    }
  }
}

export function newAggregate(
  measures: readonly AiDatasetColumn[],
  taken: readonly VisualAggregate[]
): VisualAggregate | null {
  const first = measures[0]
  if (!first) return null
  const aliases = taken.map((agg) => agg.alias)
  return { column: first.name, fn: 'sum', alias: aliasFor('sum', first.name, aliases) }
}

export function newFilter(columns: readonly AiDatasetColumn[]): VisualFilter | null {
  const first = columns[0]
  return first ? { column: first.name, op: '=', value: '' } : null
}

/**
 * A filter row the analyst has started but not finished. A row is added with an
 * empty value, so every one of them is born incomplete.
 */
export function isIncompleteFilter(filter: VisualFilter): boolean {
  return String(filter?.value ?? '').trim() === ''
}

/**
 * The filters that actually say something, which are the only ones that belong
 * in the SQL.
 *
 * An empty value means "not filled in yet", not "invalid": adding a filter row
 * used to raise a card-level alert and switch Run off before anything had been
 * typed into it. The compiler stays strict about this (a spec is not a
 * half-finished form, and an AI-authored one with a blank filter value is a
 * real error there), so the picker drops the unfinished rows on the way in and
 * marks them instead.
 *
 * The cost is that `column = ''` can no longer be expressed here. It is a rare
 * thing to want, it reads as an accident when it does appear, and the SQL
 * editor is one button away.
 */
export function activeFilters(filters: readonly VisualFilter[]): VisualFilter[] {
  return filters.filter((filter) => !isIncompleteFilter(filter))
}

export function newSort(options: readonly Option[]): VisualSort | null {
  const first = options[0]
  return first ? { column: first.value, dir: 'asc' } : null
}
