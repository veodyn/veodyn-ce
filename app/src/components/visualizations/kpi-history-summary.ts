// The KPI history chart in words: the summary a reader who cannot hover the plot
// gets instead, plus the time-order question it and the type's `validate`
// (src/lib/visualizations/kpi-history.ts) both ask of the readings.
import { isValid, parseISO } from 'date-fns'
import type { DisplayPatterns } from '@/lib/date-pattern'
import { formatDateTime } from '@/lib/format-datetime'
import type { MetricTarget } from '@/types/metric'
import { formatMetricValue } from '@/lib/metric-value-format'

/**
 * What the chart reads off one reading. Narrower than `KpiHistoryPoint`, which
 * also carries an evaluated `status` nothing here reads (the bands come from the
 * thresholds, see kpi-history-model.ts), so the registered renderer can build
 * readings out of two query-result columns without inventing one.
 */
export interface HistoryReading {
  at: string
  value: number
}

// A reading's timestamp, in the operator's configured format. Local time, not
// the UTC a chart axis uses (date-pattern.ts): a reading is an instant.
export function readingTime(at: string, patterns: DisplayPatterns): string {
  return formatDateTime(at, patterns.dateFormat, patterns.timeFormat)
}

/** Ascending, provably not ascending, or not made of instants at all. */
export type TimeOrder = 'ascending' | 'unordered' | 'unknown'

/**
 * Do the readings run forwards in time, the direction the chart draws them in?
 * Nothing re-sorts row order (see `kpiHistoryReadings`), so a result ordered
 * March 7, March 5, March 6 would otherwise be announced as "from March 7 to
 * March 6", a span the line does not show.
 *
 * Three answers because the callers differ on the third: `validate` reports only
 * 'unordered', while the summary treats anything short of 'ascending' as drawn
 * in query order.
 *
 * parseISO rather than Date.parse: V8's parser reads "Week 3" as 1 March 2001,
 * so a column of bucket labels would come back confidently backwards. Equal
 * timestamps stay ascending.
 */
export function timeOrderOf(readings: readonly { at: string }[]): TimeOrder {
  // Not 0: a reading from before 1970 parses to a negative epoch, and starting
  // at zero would call the whole series backwards on its first row.
  let previous = Number.NEGATIVE_INFINITY
  for (const reading of readings) {
    const at = parseISO(reading.at)
    if (!isValid(at)) return 'unknown'
    if (at.getTime() < previous) return 'unordered'
    previous = at.getTime()
  }
  return 'ascending'
}

/**
 * What the chart says to a reader who cannot hover it: how many readings, over
 * what span, where it started and ended, and how that sits against the target.
 */
export function historySummary(
  history: HistoryReading[],
  patterns: DisplayPatterns,
  unit?: string | null,
  target?: MetricTarget
): string {
  const first = history[0]
  const last = history[history.length - 1]
  if (!first || !last) return 'KPI history'
  const against = target ? ` Target ${formatMetricValue(target.value, unit)}.` : ''
  if (history.length === 1) {
    return (
      `KPI history: one reading, ${formatMetricValue(first.value, unit)} on ` +
      `${readingTime(first.at, patterns)}.${against}`
    )
  }
  const values = history.map((point) => point.value)
  const extremes =
    `low ${formatMetricValue(Math.min(...values), unit)}, ` +
    `high ${formatMetricValue(Math.max(...values), unit)}.`
  // "from A to B" and "started / ended" are claims about time, while the line is
  // drawn in row order, so where the two disagree the summary describes the
  // drawing rather than a range the picture does not show.
  if (timeOrderOf(history) !== 'ascending') {
    return (
      `KPI history: ${history.length} readings, drawn in the order the query returned them ` +
      `rather than in time order. First plotted ${formatMetricValue(first.value, unit)} on ` +
      `${readingTime(first.at, patterns)}, last plotted ${formatMetricValue(last.value, unit)} on ` +
      `${readingTime(last.at, patterns)}, ${extremes}${against}`
    )
  }
  return (
    `KPI history: ${history.length} readings from ${readingTime(first.at, patterns)} to ` +
    `${readingTime(last.at, patterns)}. Started at ${formatMetricValue(first.value, unit)}, ` +
    `ended at ${formatMetricValue(last.value, unit)}, ${extremes}${against}`
  )
}
