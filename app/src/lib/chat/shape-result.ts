import type { QueryResultData } from '@/lib/mock-data'
import { isDateSqlType, isNumericSqlType } from '@/lib/sql-safety'
import type { ChatResultColumn, ChatToolResult } from './wire'

export const SAMPLE_ROWS = 50
export const SAMPLE_BYTES = 32 * 1024
export const CELL_CHARS = 200
export const DISTINCT_CAP = 10_000
export const ERROR_CHARS = 500
const TOP_VALUES = 3

function trimCell(value: unknown): unknown {
  if (typeof value !== 'string' || value.length <= CELL_CHARS) return value
  return `${value.slice(0, CELL_CHARS)}…`
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function isMissing(value: unknown): boolean {
  return value === null || value === undefined
}

function describeColumn(name: string, type: string, rows: Record<string, unknown>[]): ChatResultColumn {
  const counts = new Map<string, { value: unknown; count: number }>()
  let nulls = 0
  let capped = false
  let low: number | string | undefined
  let high: number | string | undefined
  const numeric = isNumericSqlType(type)
  const ordered = numeric || isDateSqlType(type)
  for (const row of rows) {
    const value = row[name]
    if (isMissing(value)) {
      nulls += 1
      continue
    }
    if (ordered && (typeof value === 'number' || typeof value === 'string')) {
      const comparable = numeric && typeof value === 'string' ? Number(value) : value
      if (low === undefined || comparable < low) low = comparable
      if (high === undefined || comparable > high) high = comparable
    }
    if (capped) continue
    const key = typeof value === 'object' ? JSON.stringify(value) : `${typeof value}:${String(value)}`
    const entry = counts.get(key)
    if (entry) entry.count += 1
    else if (counts.size >= DISTINCT_CAP) capped = true
    else counts.set(key, { value, count: 1 })
  }
  const column: ChatResultColumn = { name, type, nulls, distinct: counts.size, distinctCapped: capped }
  if (ordered) {
    if (low !== undefined) column.min = trimCell(low)
    if (high !== undefined) column.max = trimCell(high)
  } else if (counts.size > 0) {
    column.top = [...counts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_VALUES)
      .map((entry) => ({ value: trimCell(entry.value), count: entry.count }))
  }
  return column
}

function trimRow(row: Record<string, unknown>, names: string[]): Record<string, unknown> {
  return Object.fromEntries(names.map((name) => [name, trimCell(row[name] ?? null)]))
}

export function shapeResult(data: QueryResultData): ChatToolResult {
  const names = data.columns.map((column) => column.name)
  const sample = data.rows.slice(0, SAMPLE_ROWS).map((row) => trimRow(row, names))
  while (sample.length > 0 && byteLength(sample) > SAMPLE_BYTES) sample.pop()
  return {
    ok: true,
    rowCount: data.rows.length,
    truncated: sample.length < data.rows.length,
    columns: data.columns.map((column) => describeColumn(column.name, column.type, data.rows)),
    sample,
  }
}

export function failedResult(error: unknown): ChatToolResult {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: (message || 'The query failed.').slice(0, ERROR_CHARS) }
}
