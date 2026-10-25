import type { AiDatasetColumn, GenerateSqlRequest, GenerateSqlResponse } from '@/types/ai'
import { assertSafeSqlIdentifier, isNumericSqlType, isSafeSqlIdentifier } from './sql-safety'

// Deterministic stand-in for a model, so the AI surfaces are demoable without a
// live provider (AI spec sections 1, 9). Picks a plausible column set from the
// grounding and echoes the prompt as a rationale.
//
// Deterministic means exactly that: the same request always yields the same
// response. No Math.random, no clock, no ambient state.
//
// The grounding arrives as a POST body, so the table and the column names are
// untrusted. The table name has to be an identifier or there is no query to
// generate (refused); column names that are not identifiers are dropped rather
// than emitted. The prompt only ever reaches the rationale, never the SQL.

const ROW_LIMIT = 100

export function mockGenerateSql(req: GenerateSqlRequest): GenerateSqlResponse {
  const table = assertSafeSqlIdentifier(req?.dataset?.table, 'dataset table', 3)
  const columns = (Array.isArray(req?.dataset?.columns) ? req.dataset.columns : []).filter(
    (c: AiDatasetColumn) => isSafeSqlIdentifier(c?.name, 1)
  )
  const prompt = typeof req?.prompt === 'string' ? req.prompt : ''

  // First non-numeric column is the dimension, first numeric one the measure:
  // stable ordering in, stable choice out.
  const dimension = columns.find((c) => !isNumericSqlType(c.type))?.name
  const measure = columns.find((c) => isNumericSqlType(c.type))?.name

  let select = '*'
  let group = ''
  let order = ''
  if (dimension && measure) {
    select = `${dimension}, sum(${measure}) AS ${measure}_total`
    group = `\nGROUP BY ${dimension}`
    order = `\nORDER BY ${measure}_total DESC`
  } else if (measure) {
    select = `sum(${measure}) AS ${measure}_total`
  } else if (dimension) {
    select = dimension
    order = `\nORDER BY ${dimension}`
  }

  return {
    sql: `SELECT ${select}\nFROM ${table}${group}${order}\nLIMIT ${ROW_LIMIT}`,
    rationale: `Generated from the prompt "${prompt}" grounded in ${table} (${columns.length} columns). Review the SQL before trusting the result.`,
  }
}
