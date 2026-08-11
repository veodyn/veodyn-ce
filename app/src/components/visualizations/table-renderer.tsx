'use client'

import { QueryResultTable, applyColumnConfig } from '@/components/query/query-result-table'
import { formatAutoDetectNumber } from '@/lib/chart-format'
import type { QueryResultData } from '@/lib/mock-data'
import type { VisualizationRendererProps } from '@/lib/visualizations/plugin'
import type { RedashTableOptions } from '@/services/redash/types'
import { SingleValue } from './single-value'

const NUMERIC_COLUMN_TYPES = new Set(['integer', 'float', 'decimal'])

/**
 * A KPI query is one aggregate: `SELECT uniqExact(station_id) AS stations`.
 * Redash gives such a query a TABLE visualization by default, so a dashboard
 * showed the number as a 1x1 grid, under a search box and a row count, with
 * the value in body-text size in the top-left corner and empty tile below it.
 * A single number reads as a number, not as a table of one.
 *
 * Deliberately numbers only: a lone string cell can be a paragraph, and that
 * wraps badly at counter size, so it keeps the grid.
 */
function singleNumber(view: QueryResultData): { value: string; label: string } | null {
  if (view.rows.length !== 1 || view.columns.length !== 1) return null
  const column = view.columns[0]
  const raw = view.rows[0][column.name]
  if (raw == null || raw === '') return null
  const isNumber = typeof raw === 'number' || (NUMERIC_COLUMN_TYPES.has(column.type) && !Number.isNaN(Number(raw)))
  if (!isNumber) return null
  return { value: formatAutoDetectNumber(raw), label: column.friendly_name }
}

/**
 * TABLE is the one type whose renderer does not take the standard props:
 * QueryResultTable predates the visualization interface and wants the column
 * list directly. This adapter keeps that difference out of the registry so
 * every plugin's Renderer has the same shape.
 */
export function TableRenderer({ visualization, data }: VisualizationRendererProps) {
  const options = (visualization.options ?? {}) as RedashTableOptions
  // Config first, so a hidden or renamed column is judged as it will render.
  const single = singleNumber(applyColumnConfig(data, options.columns))
  if (single) return <SingleValue value={single.value} label={single.label} />
  return <QueryResultTable data={data} columns={options.columns} />
}
