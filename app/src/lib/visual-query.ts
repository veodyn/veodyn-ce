import type { AiDatasetColumn, VisualAggregate, VisualFilter, VisualQuerySpec, VisualSort } from '@/types/ai'
import {
  assertSafeSqlIdentifier,
  isDateSqlType,
  isNumericLiteral,
  isNumericSqlType,
  normalizeSqlDateLiteral,
  quoteSqlLiteral,
  sqlSafetyError,
} from './sql-safety'

// The Visual builder compiles to SQL here, with no model call: the same spec
// always produces the same string (AI spec section 3).
//
// The spec comes from a browser field picker, so it is untrusted input even
// though TypeScript describes it. Every position is closed before it reaches
// the SQL text: names must pass the identifier allowlist (and the dataset
// schema, when the caller passes one), functions / operators / directions must
// be members of their fixed sets, the limit must be a non-negative integer, and
// filter values are emitted as escaped literals. Anything else is refused, not
// escaped into something that still runs.

const AGG_FNS = new Set(['sum', 'avg', 'count', 'min', 'max'])
const FILTER_OPS = new Set(['=', '!=', '>', '>=', '<', '<=', 'like'])
const SORT_DIRS = new Set(['asc', 'desc'])

// database.schema.table.column at the very most.
const MAX_COLUMN_PARTS = 4
const MAX_DATASET_PARTS = 3

export interface CompileVisualQueryOptions {
  /** The dataset schema. When given, every referenced column must be one of these. */
  columns?: readonly AiDatasetColumn[]
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

// A field naming another dataset (dotted with a different table prefix) means a
// cross-dataset join, which is out of the Visual subset by design (AI spec
// section 3): the UI prompts the user to continue in PRO.
export function needsJoin(spec: VisualQuerySpec): boolean {
  const dataset = typeof spec?.dataset === 'string' ? spec.dataset : ''
  // A dotted field belongs to this dataset only when the WHOLE qualifier (every
  // part before the last) equals the dataset. A `startsWith` check cleared
  // `sales.archive.amount` for dataset `sales` even though `sales.archive` is a
  // different table, so the qualifier is compared exactly.
  const refsOtherDataset = (name: unknown) => {
    if (typeof name !== 'string' || !name.includes('.')) return false
    return name.slice(0, name.lastIndexOf('.')) !== dataset
  }
  return (
    list<string>(spec?.dimensions).some(refsOtherDataset) ||
    list<VisualAggregate>(spec?.aggregates).some((a) => refsOtherDataset(a?.column)) ||
    list<VisualFilter>(spec?.filters).some((f) => refsOtherDataset(f?.column)) ||
    list<VisualSort>(spec?.sort).some((s) => refsOtherDataset(s?.column))
  )
}

// The bare column name, without its dataset qualifier, for schema lookups.
function unqualify(name: string): string {
  const parts = name.split('.')
  return parts[parts.length - 1]
}

function column(name: string, role: string, options: CompileVisualQueryOptions): string {
  const safe = assertSafeSqlIdentifier(name, role, MAX_COLUMN_PARTS)
  const schema = options.columns
  if (schema && !schema.some((c) => c?.name === unqualify(safe))) {
    throw sqlSafetyError(`The ${role} "${safe}" is not a column of this dataset`, { role, value: safe })
  }
  return safe
}

function schemaTypeOf(name: string, options: CompileVisualQueryOptions): string | undefined {
  return options.columns?.find((c) => c?.name === unqualify(name))?.type
}

function renderAggregate(agg: VisualAggregate, options: CompileVisualQueryOptions): { sql: string; alias: string } {
  const fn = agg?.fn
  if (!AGG_FNS.has(fn)) {
    throw sqlSafetyError(`Rejected an unknown aggregate function: "${String(fn)}"`, { fn: String(fn) })
  }
  // count(*) is the one non-identifier argument the picker can produce.
  const arg = agg.column === '*' && fn === 'count' ? '*' : column(agg?.column, 'aggregate column', options)
  const alias = assertSafeSqlIdentifier(agg?.alias, 'aggregate alias', 1)
  return { sql: `${fn}(${arg}) AS ${alias}`, alias }
}

function renderFilterValue(filter: VisualFilter, options: CompileVisualQueryOptions): string {
  const type = schemaTypeOf(filter.column, options)
  if (type != null && isDateSqlType(type)) {
    // A date column takes a date. Without this the value was quoted as an
    // ordinary string literal, so `captured_at >= 2026` compiled to perfectly
    // valid SQL that ClickHouse then refused with
    // "Cannot parse DateTime: while converting '2026' to DateTime64(3, 'UTC')".
    // Catching it here means the builder says so before the query is sent.
    const literal = normalizeSqlDateLiteral(filter.value)
    if (literal == null) {
      throw sqlSafetyError(
        `The filter on "${filter.column}" needs a date, as YYYY-MM-DD or YYYY-MM-DD hh:mm`,
        { column: filter.column, value: String(filter.value).slice(0, 80) }
      )
    }
    return quoteSqlLiteral(literal)
  }
  if (type != null && isNumericSqlType(type)) {
    // A numeric column takes a number and nothing else, so a payload dressed as
    // a value ("1 OR 1=1") is refused rather than quoted into a type error.
    if (!isNumericLiteral(filter.value)) {
      throw sqlSafetyError(`The filter on "${filter.column}" needs a numeric value`, {
        column: filter.column,
        value: String(filter.value).slice(0, 80),
      })
    }
    return filter.value
  }
  // Without schema types, a plain number still goes in bare (it cannot carry a
  // payload); everything else becomes an escaped literal.
  if (type == null && isNumericLiteral(filter.value)) return filter.value
  return quoteSqlLiteral(filter.value)
}

function renderFilter(filter: VisualFilter, options: CompileVisualQueryOptions): string {
  const col = column(filter?.column, 'filter column', options)
  const op = filter?.op
  if (!FILTER_OPS.has(op)) {
    throw sqlSafetyError(`Rejected an unknown filter operator: "${String(op)}"`, { op: String(op) })
  }
  return `${col} ${op} ${renderFilterValue(filter, options)}`
}

function renderSort(sort: VisualSort, selectable: Set<string>, options: CompileVisualQueryOptions): string {
  const dir = sort?.dir
  if (!SORT_DIRS.has(dir)) {
    throw sqlSafetyError(`Rejected an unknown sort direction: "${String(dir)}"`, { dir: String(dir) })
  }
  const name = assertSafeSqlIdentifier(sort?.column, 'sort column', MAX_COLUMN_PARTS)
  // ORDER BY may name an aggregate alias, which is not a schema column, so the
  // allowlist for this position is the schema plus what the SELECT introduced.
  if (options.columns && !selectable.has(name) && !options.columns.some((c) => c?.name === unqualify(name))) {
    throw sqlSafetyError(`The sort column "${name}" is neither a column of this dataset nor a selected alias`, {
      value: name,
    })
  }
  return `${name} ${dir}`
}

function renderLimit(limit: unknown): string {
  if (limit == null) return ''
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0) {
    throw sqlSafetyError(`Rejected a limit that is not a non-negative integer: "${String(limit)}"`, {
      value: String(limit),
    })
  }
  return limit > 0 ? `\nLIMIT ${limit}` : ''
}

// Deterministically compile a single-dataset spec into SQL. No model call.
export function compileVisualQuery(spec: VisualQuerySpec, options: CompileVisualQueryOptions = {}): string {
  const dataset = assertSafeSqlIdentifier(spec?.dataset, 'dataset', MAX_DATASET_PARTS)
  if (needsJoin(spec)) {
    throw sqlSafetyError('This query spans more than one dataset. Continue in the SQL editor to write the join.', { dataset })
  }

  const dimensions = list<string>(spec?.dimensions).map((d) => column(d, 'dimension', options))
  const aggregates = list<VisualAggregate>(spec?.aggregates).map((a) => renderAggregate(a, options))
  const selectable = new Set([...dimensions, ...aggregates.map((a) => a.alias)])

  const selectCols = [...dimensions, ...aggregates.map((a) => a.sql)]
  const select = selectCols.length ? selectCols.join(', ') : '*'
  const filters = list<VisualFilter>(spec?.filters).map((f) => renderFilter(f, options))
  const where = filters.length ? `\nWHERE ${filters.join(' AND ')}` : ''
  const group = aggregates.length && dimensions.length ? `\nGROUP BY ${dimensions.join(', ')}` : ''
  const sorts = list<VisualSort>(spec?.sort).map((s) => renderSort(s, selectable, options))
  const order = sorts.length ? `\nORDER BY ${sorts.join(', ')}` : ''

  return `SELECT ${select}\nFROM ${dataset}${where}${group}${order}${renderLimit(spec?.limit)}`
}
