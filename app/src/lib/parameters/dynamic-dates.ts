/**
 * Date parameter values, mirroring the Redash fork's client-side model. Two wire
 * contracts come from there:
 *
 * 1. A range is sent as `{ start, end }` (`_is_date_range` in
 *    redash/models/parameterized_query.py); SQL reads `{{ name.start }}`.
 * 2. A dynamic value is stored as the sentinel `d_<key>` and resolved per
 *    execution, so "Last 7 days" means the seven days before *this run*.
 *
 * Formats match DATETIME_FORMATS in DateParameter.js / DateRangeParameter.js.
 */
import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  sub,
} from 'date-fns'

export const DYNAMIC_PREFIX = 'd_'

/** date-fns patterns, one per parameter type Redash formats. */
const DATE_FORMATS: Record<string, string> = {
  date: 'yyyy-MM-dd',
  'datetime-local': 'yyyy-MM-dd HH:mm',
  'datetime-with-seconds': 'yyyy-MM-dd HH:mm:ss',
  'date-range': 'yyyy-MM-dd',
  'datetime-range': 'yyyy-MM-dd HH:mm',
  'datetime-range-with-seconds': 'yyyy-MM-dd HH:mm:ss',
}

export const RANGE_TYPES = ['date-range', 'datetime-range', 'datetime-range-with-seconds'] as const
export const DATE_TYPES = ['date', 'datetime-local', 'datetime-with-seconds'] as const

export function isRangeType(type: string): boolean {
  return (RANGE_TYPES as readonly string[]).includes(type)
}

export function isDateType(type: string): boolean {
  return (DATE_TYPES as readonly string[]).includes(type)
}

export interface DateRangeValue {
  start: string
  end: string
}

interface RangePreset {
  key: string
  name: string
  range: (now: Date) => [Date, Date]
}

interface DatePreset {
  key: string
  name: string
  date: (now: Date) => Date
}

/**
 * Rolling windows end at the run instant, not the end of the day, matching
 * Redash's `untilNow`: ending at midnight would include hours yet to happen.
 */
const untilNow =
  (from: (now: Date) => Date) =>
  (now: Date): [Date, Date] => [from(now), now]

export const DYNAMIC_DATE_RANGES: RangePreset[] = [
  { key: 'today', name: 'Today', range: (n) => [startOfDay(n), endOfDay(n)] },
  {
    key: 'yesterday',
    name: 'Yesterday',
    range: (n) => {
      const d = sub(n, { days: 1 })
      return [startOfDay(d), endOfDay(d)]
    },
  },
  { key: 'this_week', name: 'This week', range: (n) => [startOfWeek(n), endOfWeek(n)] },
  { key: 'this_month', name: 'This month', range: (n) => [startOfMonth(n), endOfMonth(n)] },
  { key: 'this_year', name: 'This year', range: (n) => [startOfYear(n), endOfYear(n)] },
  {
    key: 'last_week',
    name: 'Last week',
    range: (n) => {
      const d = sub(n, { weeks: 1 })
      return [startOfWeek(d), endOfWeek(d)]
    },
  },
  {
    key: 'last_month',
    name: 'Last month',
    range: (n) => {
      const d = sub(n, { months: 1 })
      return [startOfMonth(d), endOfMonth(d)]
    },
  },
  {
    key: 'last_year',
    name: 'Last year',
    range: (n) => {
      const d = sub(n, { years: 1 })
      return [startOfYear(d), endOfYear(d)]
    },
  },
  { key: 'last_hour', name: 'Last hour', range: untilNow((n) => sub(n, { hours: 1 })) },
  { key: 'last_8_hours', name: 'Last 8 hours', range: untilNow((n) => sub(n, { hours: 8 })) },
  { key: 'last_24_hours', name: 'Last 24 hours', range: untilNow((n) => sub(n, { hours: 24 })) },
  {
    key: 'last_7_days',
    name: 'Last 7 days',
    range: untilNow((n) => startOfDay(sub(n, { days: 7 }))),
  },
  {
    key: 'last_14_days',
    name: 'Last 14 days',
    range: untilNow((n) => startOfDay(sub(n, { days: 14 }))),
  },
  {
    key: 'last_30_days',
    name: 'Last 30 days',
    range: untilNow((n) => startOfDay(sub(n, { days: 30 }))),
  },
  {
    key: 'last_60_days',
    name: 'Last 60 days',
    range: untilNow((n) => startOfDay(sub(n, { days: 60 }))),
  },
  {
    key: 'last_90_days',
    name: 'Last 90 days',
    range: untilNow((n) => startOfDay(sub(n, { days: 90 }))),
  },
  {
    key: 'last_12_months',
    name: 'Last 12 months',
    range: untilNow((n) => startOfDay(sub(n, { months: 12 }))),
  },
  {
    key: 'last_2_years',
    name: 'Last 2 years',
    range: untilNow((n) => startOfDay(sub(n, { years: 2 }))),
  },
  {
    key: 'last_3_years',
    name: 'Last 3 years',
    range: untilNow((n) => startOfDay(sub(n, { years: 3 }))),
  },
  {
    key: 'last_10_years',
    name: 'Last 10 years',
    range: untilNow((n) => startOfDay(sub(n, { years: 10 }))),
  },
]

export const DYNAMIC_DATES: DatePreset[] = [
  { key: 'now', name: 'Today/Now', date: (n) => n },
  { key: 'yesterday', name: 'Yesterday', date: (n) => sub(n, { days: 1 }) },
]

function presetKey(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith(DYNAMIC_PREFIX)
    ? value.slice(DYNAMIC_PREFIX.length)
    : null
}

/** True only for a sentinel this module can actually resolve. */
export function isDynamicValue(value: unknown): boolean {
  const key = presetKey(value)
  if (key === null) return false
  return (
    DYNAMIC_DATE_RANGES.some((p) => p.key === key) || DYNAMIC_DATES.some((p) => p.key === key)
  )
}

export function isDateRangeValue(value: unknown): value is DateRangeValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as DateRangeValue).start === 'string' &&
    typeof (value as DateRangeValue).end === 'string'
  )
}

/**
 * Whether two parameter values are the same, for "has this been edited". A range
 * is an object, so identity would report every render as a change.
 */
export function sameParameterValue(a: unknown, b: unknown): boolean {
  if (isDateRangeValue(a) && isDateRangeValue(b)) {
    return a.start === b.start && a.end === b.end
  }
  // A multi-value parameter holds a list, and order is what the backend joins
  // into the SQL, so it is meaningful.
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => Object.is(item, b[i]))
  }
  return Object.is(a, b)
}

/**
 * The value to put on the wire for one parameter. Anything this module does not
 * own passes through untouched, so callers can hand it every parameter blindly.
 */
export function resolveParameterValue(type: string, value: unknown, now: Date): unknown {
  const pattern = DATE_FORMATS[type]
  if (!pattern) return value

  const key = presetKey(value)
  if (key === null) return value

  if (isRangeType(type)) {
    const preset = DYNAMIC_DATE_RANGES.find((p) => p.key === key)
    // An unknown sentinel passes through rather than becoming null: the backend
    // refusing it is legible, an empty range looks like real data.
    if (!preset) return value
    const [start, end] = preset.range(now)
    return { start: format(start, pattern), end: format(end, pattern) }
  }

  const preset = DYNAMIC_DATES.find((p) => p.key === key)
  if (!preset) return value
  return format(preset.date(now), pattern)
}

/** Resolves a whole parameter set for one execution. */
export function resolveParameterValues(
  parameters: Array<{ name: string; type: string }>,
  values: Record<string, unknown>,
  now: Date
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...values }
  for (const p of parameters) {
    if (p.name in resolved) {
      resolved[p.name] = resolveParameterValue(p.type, resolved[p.name], now)
    }
  }
  return resolved
}
