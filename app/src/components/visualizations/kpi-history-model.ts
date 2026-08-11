// Recovering a KPI_HISTORY visualization's meaning from its stored options.
//
// A registered visualization is handed `{ visualization, data }` and nothing
// else, so everything the KPI page passes as a typed prop has to be recovered:
// the readings out of two result columns, and the target and thresholds out of
// the options bag. That recovery lives here rather than beside the renderer
// because `validate` in lib/visualizations/kpi-history.ts calls three of these
// functions, and the plugin's metadata is registered eagerly on every route.
// While they sat in kpi-history-renderer.tsx, importing them pulled that
// module in, and with it KpiHistoryChart and the whole of recharts, onto
// pages with no chart on them. Splitting the model from the drawing is what
// lets the renderer be loaded on demand.
import type { QueryResultData } from '@/lib/mock-data'
import type { RedashKpiHistoryOptions } from '@/services/redash/types'
import type { MetricTarget, MetricThresholds } from '@/types/metric'
import type { HistoryReading } from './kpi-history-summary'

/**
 * Which columns this visualization reads, after the positional fallback.
 *
 * The fallback is the funnel's: an unset key means "the obvious column" rather
 * than "unconfigured", so a widget created from the builder draws immediately
 * instead of showing an empty panel until somebody opens the editor. It is
 * deliberately not written back into the options, so `validate` still treats an
 * unset key as unset and only complains about a column that was named and is
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
 * The reading a value cell holds, or null when it holds no reading.
 *
 * `Number()` answers a question nobody asked of a blank or a boolean: it reads
 * a whitespace-only cell as 0, false as 0 and true as 1, all finite. Pick a
 * boolean column by mistake, or take a padded blank from a source that pads,
 * and the chart draws dips and threshold breaches that never happened, which a
 * reader cannot tell from real ones. Only a number, or a string that is
 * entirely a number, is a reading. Strings cannot simply be refused: a
 * ClickHouse Decimal arrives as one.
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
 * The label a timestamp cell carries, or null when it carries none.
 *
 * Trimmed for the same reason the value is: a cell of spaces is a blank the
 * source failed to fill, and plotting it puts a nameless tick on the axis and
 * an empty date in the tooltip.
 */
function readingAt(raw: unknown): string | null {
  if (raw == null) return null
  const at = String(raw).trim()
  return at === '' ? null : at
}

/**
 * The readings, in the order the query returned them.
 *
 * Not sorted here on purpose, and the choice is between two honest options:
 * sort by the time column, or leave the order alone and report an out-of-order
 * result through `validate`. Reporting wins because row order is the query's
 * answer. Someone who wrote ORDER BY meant it, sorting would make this chart
 * disagree with the table of the same result beside it on the same dashboard,
 * and the time column is allowed to hold bucket labels that no sort could put
 * in order anyway. What the drawing must not do is CLAIM an order it does not
 * have, so `timeOrderOf` guards the chart's accessible description and
 * `validate` says the same thing to the person who can fix it, in the query.
 *
 * A row missing either value is dropped rather than plotted as 0, which would
 * draw a dip the data does not have. So is a blank-looking or non-numeric one:
 * see `readingValue`.
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
    // null and `Number(null)` is 0, which is finite, so the reading a data
    // source failed to produce would be plotted as a dip to zero that nobody
    // could tell from a real one.
    const at = readingAt(row[timeColumn])
    const value = readingValue(row[valueColumn])
    if (at === null || value === null) continue
    readings.push({ at, value })
  }
  return readings
}

/**
 * The target line, or undefined when there is nothing to compare against.
 *
 * A bare `{ value: 90 }` means higher-is-better, which is MetricTarget's own
 * commoner sense and what an author writing only a number intends. Anything
 * other than the explicit 'lower-is-better' therefore reads as higher, rather
 * than making the whole target undefined over a missing direction.
 */
export function kpiHistoryTarget(options: RedashKpiHistoryOptions): MetricTarget | undefined {
  const value = options.target?.value
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const direction = options.target?.direction === 'lower-is-better' ? 'lower-is-better' : 'higher-is-better'
  return { value, direction }
}

/**
 * The status bands, or undefined unless BOTH bounds are real numbers.
 *
 * Half a threshold pair cannot place a band: statusBands would clamp the
 * missing side to the edge of the domain and shade half the plot a colour the
 * author never asked for. Treating it as absent is the honest degradation, and
 * `validate` is what says so out loud.
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
