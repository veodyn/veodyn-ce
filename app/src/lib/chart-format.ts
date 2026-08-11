// Shared number/date formatting for chart, counter, and table renderers.
// One module so formatting logic isn't duplicated per-renderer.

import { formatUtcPattern, withSeconds, type DisplayPatterns } from './date-pattern'
import { formatAgeCompact } from './format-datetime'

const COMPACT_SUFFIXES: [number, string][] = [
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
]

export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  const abs = Math.abs(value)
  for (const [threshold, suffix] of COMPACT_SUFFIXES) {
    if (abs >= threshold) {
      return `${(value / threshold).toFixed(abs >= threshold * 100 ? 0 : 1)}${suffix}`
    }
  }
  return value.toLocaleString()
}

// At least this many significant digits survive for a fraction under 1: a
// flat toFixed(2) collapses e.g. 0.004 to "0.00", the exact defect this
// constant exists to avoid.
const EXACT_NUMBER_SIGNIFICANT_DIGITS = 2

// Bounded-precision exact value, for a context that needs the true value
// rather than formatCompactNumber's abbreviated form but cannot show raw
// floating-point division noise: an 'avg' aggregation of 10, 20, and 25 is
// 18.333333333333332 in IEEE 754, and every digit past the first couple is
// representation error, not real precision the underlying integer data has.
// No thousands separator, unlike formatCompactNumber's own fallback: this
// feeds an accessible name and a tooltip built to read the same as the value
// already interpolated there, and toLocaleString's comma would be a second,
// unrelated formatting change riding along with the precision fix.
//
// For abs >= 1, EXACT_NUMBER_SIGNIFICANT_DIGITS decimal places already
// carries that many significant digits for any everyday UI value (an 'avg'
// of 10/20/25 stays "18.33"). For abs < 1, a flat decimal count would lose
// every digit for a small enough fraction, so the count grows with how many
// leading zeros sit before the first significant digit (0.004 needs 4
// decimal places, not 2, to show 2 significant digits: "0.0040").
export function formatExactNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (Number.isInteger(value)) return String(value)
  const abs = Math.abs(value)
  if (abs >= 1) return value.toFixed(EXACT_NUMBER_SIGNIFICANT_DIGITS)
  const decimals = -Math.floor(Math.log10(abs)) - 1 + EXACT_NUMBER_SIGNIFICANT_DIGITS
  // toFixed throws RangeError outside 0-100 digits, and for abs below roughly
  // 1e-99 the leading-zero count alone asks for more than that. Clamping the
  // count to 100 stopped the throw but printed "0." followed by 100 zeros:
  // no exception, but a value that is not zero reading as zero in the one
  // string built to carry the EXACT value (describeHeatmapCell uses this for
  // a cell's accessible name and its tooltip). Exponential notation keeps the
  // value instead of silently rounding it away.
  if (decimals > 100) return value.toExponential(EXACT_NUMBER_SIGNIFICANT_DIGITS - 1)
  return value.toFixed(decimals)
}

// Log-scale axes should label ticks by their linear (decoded) value, not the
// log-transformed plot coordinate, so this takes the already-linear value —
// same formatting as formatCompactNumber, kept distinct so call sites read
// as "this is a log axis tick" without inspecting the axis config.
export function formatCompactLogValue(value: number): string {
  return formatCompactNumber(value)
}

export function formatAutoDetectNumber(
  value: unknown,
  options?: { prefix?: string; suffix?: string; decimals?: number },
): string {
  if (value == null || value === '') return '-'
  const num = Number(value)
  if (Number.isNaN(num)) return String(value)
  const formatted =
    options?.decimals != null
      ? num.toLocaleString(undefined, { minimumFractionDigits: options.decimals, maximumFractionDigits: options.decimals })
      : num.toLocaleString()
  return `${options?.prefix ?? ''}${formatted}${options?.suffix ?? ''}`
}

// Matches ISO date/datetime strings with no timezone designator, e.g.
// "2026-03-19", "2026-03-19T08:00:00", or ClickHouse's space-separated
// "2026-03-19 08:00:00.919" (no trailing Z or ±HH:MM).
const NAIVE_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/

// The same shape, plus the timezone-carrying strings that need no fixing up.
// Used to decide whether a column holds dates at all, so it deliberately does
// not accept bare numbers: an integer column would otherwise read as epochs.
const DATE_LIKE_PATTERN = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/
const HAS_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/

export function parseDateValue(value: unknown): number | null {
  if (value == null) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  // ClickHouse/Redash return naive datetime strings meant as UTC; without
  // this, Date.parse treats them as local time and formatting back to UTC
  // shifts the displayed hour by the local timezone offset.
  const str = String(value)
  const parsed = Date.parse(NAIVE_ISO_PATTERN.test(str) ? `${str.replace(' ', 'T')}Z` : str)
  return Number.isNaN(parsed) ? null : parsed
}

// A column's declared type is not enough to know it holds timestamps. Redash's
// ClickHouse runner only maps the exact type "datetime" (see
// _define_column_type in node/redash/query_runner/clickhouse.py), so
// DateTime64(3) and DateTime('UTC') columns arrive typed as strings and their
// raw cells end up on the axis. Sampling the values catches those, and covers
// any other runner with the same gap, without touching the fork.
const DATE_SAMPLE_SIZE = 20

export interface DateColumnShape {
  isDate: boolean
  // Sub-day granularity, i.e. at least one sampled value carries a clock time.
  hasTime: boolean
}

export function detectDateColumn(values: unknown[]): DateColumnShape {
  let sampled = 0
  let hasTime = false
  for (const value of values) {
    if (value == null || value === '') continue
    if (!(typeof value === 'string' && DATE_LIKE_PATTERN.test(value))) return { isDate: false, hasTime: false }
    hasTime = hasTime || HAS_TIME_PATTERN.test(value)
    if (++sampled === DATE_SAMPLE_SIZE) break
  }
  return sampled === 0 ? { isDate: false, hasTime: false } : { isDate: true, hasTime }
}

export function sortRowsByDateX<T extends Record<string, unknown>>(rows: T[], xCol: string): T[] {
  const withDates = rows.map((row) => ({ row, ts: parseDateValue(row[xCol]) }))
  if (withDates.some(({ ts }) => ts == null)) return rows
  return withDates.sort((a, b) => (a.ts as number) - (b.ts as number)).map(({ row }) => row)
}

// Accepts recharts' loosely-typed label/tooltip value shapes (string | number
// | undefined | arrays thereof) and renders whatever numeric formatting makes
// sense, falling back to a plain string for everything else.
export function formatLabelValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'number') return formatCompactNumber(value)
  return String(value)
}

// includeTime: pass true for datetime-typed columns with sub-day granularity
// (e.g. hourly data) so same-day points remain visually distinguishable —
// date-only columns show the configured date alone.
//
// The form is the operator's, from Settings > Formats: the same date pattern a
// table cell or a report byline uses, in UTC (see date-pattern.ts) so a tooltip
// names the tick the reader is hovering rather than a timestamp an hour off it.
//
// Seconds are added when the value has them and the configured time pattern
// would have hidden them. This is the full-precision label (tooltips, the
// accessible summary), the one place a reader gets the exact instant, so it does
// not round a 08:30:17 reading down to 08:30. Axis ticks go through
// formatDateTick, which takes its precision from the axis span instead.
export function formatDateLabel(
  value: unknown,
  includeTime: boolean,
  patterns: DisplayPatterns,
): string {
  const ts = parseDateValue(value)
  if (ts == null) return String(value)
  if (!includeTime) return formatUtcPattern(ts, patterns.dateFormat)
  const timePattern = ts % 60_000 === 0 ? patterns.timeFormat : withSeconds(patterns.timeFormat)
  return `${formatUtcPattern(ts, patterns.dateFormat)} ${formatUtcPattern(ts, timePattern)}`
}

/**
 * Dense freshness chrome. Delegates to the one age ladder so a widget header
 * and the prose next to it cannot disagree about how old the same result is;
 * this used to stop at days and render "129d ago" beside "4 months ago".
 */
export function formatRelativeTime(isoDate: string | null | undefined, now: number): string {
  if (!isoDate) return 'never'
  if (Number.isNaN(Date.parse(isoDate))) return 'never'
  return formatAgeCompact(isoDate, now)
}
