// The KPI history chart in words: the summary a reader who cannot hover the
// plot gets instead, and the one question that summary has to ask of the
// readings before it may describe them as a span of time.
//
// Split out of kpi-history-chart.tsx because the type's `validate` asks the
// same question (src/lib/visualizations/kpi-history.ts) and the chart is at the
// size the pre-tool hook blocks at. A .ts rather than a .tsx: it draws nothing.
import { isValid, parseISO } from 'date-fns'
import type { DisplayPatterns } from '@/lib/date-pattern'
import { formatDateTime } from '@/lib/format-datetime'
import type { MetricTarget } from '@/types/metric'
import { formatMetricValue } from '@/lib/metric-value-format'

/**
 * What the chart reads off one reading.
 *
 * Narrower than `KpiHistoryPoint`, deliberately. A point also carries the
 * `status` it was evaluated to, and nothing here reads it: the bands come from
 * the thresholds (see kpi-history-model.ts) rather than from per-point verdicts.
 * Declaring only what is read is what lets the registered renderer build
 * readings out of two query-result columns without inventing a status nobody
 * would look at.
 */
export interface HistoryReading {
  at: string
  value: number
}

// A reading's timestamp, in the operator's configured format. Local time, not
// the UTC a chart axis uses (date-pattern.ts): a reading is an instant like a
// table cell's, and there are no round boundaries here for a label to sit on.
export function readingTime(at: string, patterns: DisplayPatterns): string {
  return formatDateTime(at, patterns.dateFormat, patterns.timeFormat)
}

/** Ascending, provably not ascending, or not made of instants at all. */
export type TimeOrder = 'ascending' | 'unordered' | 'unknown'

/**
 * Do the readings run forwards in time, which is the direction the chart draws
 * them in left to right?
 *
 * Row order is the query's answer and nothing re-sorts it (see
 * `kpiHistoryReadings` for why). That leaves the drawing honest and the WORDS
 * at risk: a result ordered March 7, March 5, March 6 would otherwise be
 * announced as "from March 7 to March 6", a span that runs backwards and that
 * the line does not show. So the summary asks first, and `validate` reports the
 * same answer to the person who can fix it, in the query.
 *
 * Three answers rather than two, because the callers want different defaults
 * for the third. `validate` reports only 'unordered', since a warning about a
 * column nothing can read as a time is one nobody can act on. The summary
 * describes anything short of 'ascending' as drawn in query order, because
 * announcing a span it could not verify is the defect it exists to avoid.
 *
 * parseISO rather than Date.parse: V8's own parser reads "Week 3" as 1 March
 * 2001, so a column of bucket labels would come back confidently backwards.
 * Equal timestamps stay ascending, since two readings at the same instant are
 * out of order through nothing the query did.
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
 * What the chart says to a reader who cannot hover it.
 *
 * A bare `aria-label="KPI history"` described the element and none of its
 * content, which for a chart whose entire content is numbers is close to saying
 * nothing. This is the summary a sighted reader takes from the shape: how many
 * readings, over what span, where it started and where it ended, and now how
 * that sits against the target, which is the one comparison the picture exists
 * to make.
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
  // "from A to B" and "started / ended" are claims about time, and the line is
  // drawn in row order. Where the two disagree the summary describes the
  // drawing, because that is what it is a summary OF: announcing a range the
  // picture does not show is worse than the picture alone.
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
