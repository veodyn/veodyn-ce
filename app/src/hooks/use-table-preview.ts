'use client'

// A read-only sample of a schema table, for the eye button in the schema
// browser. Deliberately its own hook rather than useExecuteQuery: that mutation
// owns the editor's Run button (it drives the results pane, the cancel handle
// and the "is executing" state), and a peek at a table must not disturb any of
// them. This is a cached read keyed by (data source, table) instead.

import { useQuery } from '@tanstack/react-query'
import { USE_REAL_API } from '@/services/redash/config'
import * as execution from '@/services/redash/execution'
import { assertSafeSqlIdentifier } from '@/lib/sql-safety'
import type { QueryResultData, SchemaColumn } from '@/lib/mock-data'

export const TABLE_PREVIEW_ROWS = 10

/**
 * The SQL the preview runs. Exported so the dialog can show what it ran.
 *
 * The table name is interpolated, so it is checked first rather than trusted
 * for arriving from the schema endpoint: a name carrying a quote or a comment
 * marker would not just fail, it would change the statement this builds. Two
 * parts, because a warehouse table is `database.table` here.
 */
export function tablePreviewSql(table: string): string {
  const safe = assertSafeSqlIdentifier(table, 'preview table', 2)
  return `SELECT *\nFROM ${safe}\nLIMIT ${TABLE_PREVIEW_ROWS}`
}

export interface TablePreview {
  data: QueryResultData
  /** Seconds the backend spent, when it reported one. */
  runtime: number | null
}

interface UseTablePreviewArgs {
  dataSourceId: number
  table: string
  /** Schema columns, used to shape the fixture sample in mock mode. */
  columns: SchemaColumn[]
  enabled: boolean
}

export function useTablePreview({ dataSourceId, table, columns, enabled }: UseTablePreviewArgs) {
  return useQuery<TablePreview>({
    queryKey: ['table-preview', dataSourceId, table],
    queryFn: async ({ signal }) => {
      // Built before the mode branch so a name this cannot express is refused
      // in fixture mode too, rather than only where it would reach a warehouse.
      const sql = tablePreviewSql(table)
      if (USE_REAL_API) {
        const result = await execution.executeAdhoc(dataSourceId, sql, { signal })
        return { data: result.data, runtime: result.runtime }
      }
      return { data: mockPreview(columns), runtime: 0.02 }
    },
    enabled: enabled && dataSourceId > 0 && table.length > 0,
    // A sample is a sample: reopening the same table inside a session shows the
    // rows already fetched rather than running the query again.
    staleTime: 5 * 60 * 1000,
    // One failed peek should not turn into three queued executions on the
    // warehouse.
    retry: false,
  })
}

// Fixture mode has no warehouse to read, so the sample is derived from the
// schema: same columns, same types, obviously synthetic values.
function mockPreview(columns: SchemaColumn[]): QueryResultData {
  const rows = Array.from({ length: TABLE_PREVIEW_ROWS }, (_, i) =>
    Object.fromEntries(columns.map((col) => [col.name, mockValue(col, i)]))
  )
  return {
    columns: columns.map((col) => ({
      name: col.name,
      friendly_name: col.name,
      type: resultType(col.type),
    })),
    rows,
  }
}

/** Maps a warehouse column type onto the coarse type a result grid renders by. */
function resultType(type: string): string {
  const t = type.toLowerCase()
  if (t.includes('datetime') || t.includes('timestamp')) return 'datetime'
  if (t.includes('date')) return 'date'
  if (t.includes('float') || t.includes('double') || t.includes('decimal')) return 'float'
  if (t.includes('int')) return 'integer'
  if (t.includes('bool')) return 'boolean'
  return 'string'
}

function mockValue(col: SchemaColumn, row: number): unknown {
  switch (resultType(col.type)) {
    case 'datetime':
    case 'date':
      return new Date(Date.UTC(2026, 0, 1, 12, row)).toISOString()
    case 'float':
      return Number((row + 1) * 1.5)
    case 'integer':
      return row + 1
    case 'boolean':
      return row % 2 === 0
    default:
      return `${col.name}-${row + 1}`
  }
}
