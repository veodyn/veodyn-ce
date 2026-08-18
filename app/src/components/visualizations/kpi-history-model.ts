// Recovering a KPI_HISTORY visualization's meaning (readings, target,
// thresholds) from `{ visualization, data }` and its stored options. Kept out
// of kpi-history-renderer.tsx because `validate` in
// lib/visualizations/kpi-history.ts calls three of these and is registered
// eagerly on every route, which would pull recharts onto pages with no chart.
import type { QueryResultData } from '@/lib/mock-data'
import type { RedashKpiHistoryOptions } from '@/services/redash/types'
import type { MetricTarget, MetricThresholds } from '@/types/metric'
import type { HistoryReading } from './kpi-history-summary'

/**
 * Which columns this visualization reads, after the funnel's positional
 * fallback: an unset key means "the obvious column", so a widget from the
 * builder draws immediately. The fallback is not written back into the options,
 * so `validate` still only complains about a column that was named and is
 * missing.
 */
export function kpiHistoryColumns(
  options: RedashKpiHistoryOptions,
  data: QueryResultData
): { timeColumn: string; valueColumn: string } {
  return {
    timeColumn: options.timeColumn || data.columns[0]?.name || '',
    valueColumn: options.valueColumn || data.columns[1]?.name || '',
  }
}

/**
 * The reading a value cell holds, or null when it holds no reading. `Number()`
 * reads a whitespace-only cell as 0, false as 0 and true as 1, all finite, so
 * only a number or a wholly numeric string counts. Strings cannot be refused
 * outright: a ClickHouse Decimal arrives as one.
 */
function readingValue(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/**
 * The label a timestamp cell carries, or null when it carries none. Trimmed
 * because a cell of spaces plots a nameless tick and an empty tooltip date.
 */
function readingAt(raw: unknown): string | null {
  if (raw == null) return null
  const at = String(raw).trim()
  return at === '' ? null : at
}

/**
 * The readings, in the order the query returned them. Not sorted: row order is
 * the query's answer, and the time column may hold bucket labels no sort could
 * order. An out-of-order result is reported instead, by `timeOrderOf` (which
 * guards the accessible description) and by `validate`.
 *
 * A row missing either value is dropped rather than plotted as 0, which would
 * draw a dip the data does not have.
 */
export function kpiHistoryReadings(
  options: RedashKpiHistoryOptions,
  data: QueryResultData
): HistoryReading[] {
  const { timeColumn, valueColumn } = kpiHistoryColumns(options, data)
  if (!timeColumn || !valueColumn) return []
  const readings: HistoryReading[] = []
  for (const row of data.rows) {
    // Both cells are resolved before either is trusted: a SQL NULL arrives as
    // null and `Number(null)` is a finite 0, which would plot as a real dip.
    const at = readingAt(row[timeColumn])
    const value = readingValue(row[valueColumn])
    if (at === null || value === null) continue
    readings.push({ at, value })
  }
  return readings
}

/**
 * The target line, or undefined when there is nothing to compare against.
 * Anything other than an explicit 'lower-is-better' reads as higher-is-better,
 * so a bare `{ value: 90 }` is a target rather than undefined.
 */
export function kpiHistoryTarget(options: RedashKpiHistoryOptions): MetricTarget | undefined {
  const value = options.target?.value
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const direction = options.target?.direction === 'lower-is-better' ? 'lower-is-better' : 'higher-is-better'
  return { value, direction }
}

/**
 * The status bands, or undefined unless BOTH bounds are real numbers: with
 * half a pair, statusBands would clamp the missing side to the edge of the
 * domain and shade half the plot. `validate` reports the missing bound.
 */
export function kpiHistoryThresholds(
  options: RedashKpiHistoryOptions
): MetricThresholds | undefined {
  const atRisk = options.thresholds?.atRisk
  const breached = options.thresholds?.breached
  if (typeof atRisk !== 'number' || !Number.isFinite(atRisk)) return undefined
  if (typeof breached !== 'number' || !Number.isFinite(breached)) return undefined
  return { atRisk, breached }
}
