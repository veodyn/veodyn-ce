// Settings > Formats let an operator pick a date and time format, saved them,
// and no surface in the product read them back. Meanwhile dates rendered three
// different ways depending on which screen you were on. This is the one place
// that turns the configured format into text.
//
// Relative times ("4 months ago") are deliberately not covered: they answer a
// different question than a date does, and the decision was to leave them.
//
// Charts used to be left out too, on ISO. They are not anymore: date-pattern.ts
// renders the same configured patterns off an instant's UTC components, which is
// the coordinate space a time axis places its ticks in, and reshapes them to the
// precision each axis is drawing at.

import { format as formatWithPattern, isValid, parseISO } from 'date-fns'

// Redash stores moment.js patterns, which is what its own settings UI offers.
// date-fns uses a different token vocabulary for the same fields, so the
// pattern is translated rather than the library swapped.
const TOKEN_MAP: [RegExp, string][] = [
  [/YYYY/g, 'yyyy'],
  [/YY/g, 'yy'],
  [/DD/g, 'dd'],
  [/D(?![a-zA-Z])/g, 'd'],
  [/A/g, 'a'],
]

export const DEFAULT_DATE_FORMAT = 'MM/DD/YY'
export const DEFAULT_TIME_FORMAT = 'HH:mm'

export function toDateFnsPattern(pattern: string): string {
  return TOKEN_MAP.reduce((acc, [token, replacement]) => acc.replace(token, replacement), pattern)
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return isValid(value) ? value : null
  if (typeof value === 'number') {
    const fromEpoch = new Date(value)
    return isValid(fromEpoch) ? fromEpoch : null
  }
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = parseISO(value)
  if (isValid(parsed)) return parsed
  // Not every backend hands back ISO. Date's own parser is looser and is the
  // right fallback here, since the alternative is showing nothing.
  const loose = new Date(value)
  return isValid(loose) ? loose : null
}

/**
 * The date in the configured pattern, or the value unchanged when it is not a
 * date at all. Returning the original matters: a text column that happens to
 * reach this code should show what it holds, not "Invalid Date".
 */
export function formatDate(value: unknown, pattern: string = DEFAULT_DATE_FORMAT): string {
  const date = toDate(value)
  if (!date) return value == null ? '' : String(value)
  try {
    return formatWithPattern(date, toDateFnsPattern(pattern))
  } catch {
    // An operator can type a pattern date-fns rejects. Falling back keeps the
    // page readable instead of throwing inside a table cell.
    return formatWithPattern(date, toDateFnsPattern(DEFAULT_DATE_FORMAT))
  }
}

export type AgeUnit = 'never' | 'now' | 'second' | 'minute' | 'hour' | 'day' | 'month' | 'year'

export interface RelativeAge {
  value: number
  unit: AgeUnit
}

// Months are not a fixed length, so the boundary is the mean Gregorian month.
// Nothing here needs calendar precision: it decides which word to print.
const DAYS_PER_MONTH = 30.44

/** A date with no time and no zone, which is a calendar day and nothing more. */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * How long ago something was, on one ladder: seconds, minutes and hours below a
 * day, then **days up to 30, months up to 12, then years**.
 *
 * One ladder because there were two. Dashboard widget chrome capped at days and
 * showed "129d ago" while the prose beside it said "4 months ago" for the same
 * instant, so the same freshness read as two different ages depending on which
 * component rendered it. Callers differ only in how they spell the unit.
 */
export function relativeAge(value: string | number | Date | null | undefined, now: number): RelativeAge {
  const date = toDate(value)
  const then = date?.getTime()
  // 'never' rather than 'now': a timestamp that will not parse is not a recent
  // one, and folding the two together made <TimeAgo date="not a date" /> read
  // "just now" where it used to read "Never".
  if (then == null || Number.isNaN(then)) return { value: 0, unit: 'never' }

  // Each threshold is tested against the unrounded elapsed value. Comparing
  // rounded ones moved every boundary half a unit early: 29 days 12 hours
  // rounded to 30 days and so printed as "1 month".
  const seconds = Math.max(0, (now - then) / 1000)
  if (seconds < 10) return { value: 0, unit: 'now' }
  if (seconds < 60) return { value: Math.round(seconds), unit: 'second' }

  const minutes = seconds / 60
  if (minutes < 60) return { value: Math.round(minutes), unit: 'minute' }

  const hours = minutes / 60
  if (hours < 24) return { value: Math.round(hours), unit: 'hour' }

  // Whole units below the boundary are floored, not rounded, so the number
  // shown can never reach the threshold that would have changed the word:
  // "30 days ago" is a contradiction when 30 days is a month.
  const days = hours / 24
  if (days < 30) return { value: Math.floor(days), unit: 'day' }

  const months = days / DAYS_PER_MONTH
  if (months < 12) return { value: Math.max(1, Math.floor(months)), unit: 'month' }

  return { value: Math.max(1, Math.floor(days / (DAYS_PER_MONTH * 12))), unit: 'year' }
}

const COMPACT_UNIT: Record<Exclude<AgeUnit, 'now' | 'never'>, string> = {
  second: 's',
  minute: 'm',
  hour: 'h',
  day: 'd',
  month: 'mo',
  year: 'y',
}

/** The ladder in dense chrome form: "3d ago", "4mo ago". */
export function formatAgeCompact(value: string | number | Date | null | undefined, now: number): string {
  const { value: n, unit } = relativeAge(value, now)
  if (unit === 'never') return 'never'
  if (unit === 'now') return 'just now'
  return `${n}${COMPACT_UNIT[unit]} ago`
}

/** The ladder in prose form: "3 days ago", "4 months ago". */
export function formatAgeProse(value: string | number | Date | null | undefined, now: number): string {
  const { value: n, unit } = relativeAge(value, now)
  if (unit === 'never') return 'Never'
  if (unit === 'now') return 'just now'
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`
}

/**
 * A **calendar** date in the configured pattern: a coverage boundary, a
 * effective-from, anything whose meaning is "this day" rather than "this
 * instant".
 *
 * `formatDate` renders in local time, which is right for a timestamp and wrong
 * here. A backend sends a date-only value as UTC midnight, and west of UTC that
 * formats as the previous day: `2020-06-01T00:00:00Z` displayed as 05/31/20.
 * This reads the UTC components instead, so the day printed is the day stored.
 */
export function formatCalendarDate(value: unknown, pattern: string = DEFAULT_DATE_FORMAT): string {
  // A plain YYYY-MM-DD has no instant in it, and date-fns parses it as *local*
  // midnight. Reading UTC components off that would move it back a day west of
  // UTC, so the literal components are used as written and no zone is involved.
  if (typeof value === 'string') {
    const parts = DATE_ONLY.exec(value.trim())
    if (parts) {
      const [, year, month, day] = parts
      return formatDate(new Date(Number(year), Number(month) - 1, Number(day)), pattern)
    }
  }

  const date = toDate(value)
  if (!date) return value == null ? '' : String(value)

  // Anything else is an instant, and the day wanted is the UTC one. Rebuilding
  // from UTC components rather than adding getTimezoneOffset() matters twice:
  // the arithmetic version shifted the wrong way east of UTC, and it broke
  // outright when the offset differed between the instant and the result (a DST
  // boundary, or Egypt reintroducing summer time).
  return formatDate(
    new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    pattern
  )
}

export function formatDateTime(
  value: unknown,
  datePattern: string = DEFAULT_DATE_FORMAT,
  timePattern: string = DEFAULT_TIME_FORMAT
): string {
  const date = toDate(value)
  if (!date) return value == null ? '' : String(value)
  return `${formatDate(date, datePattern)} ${formatDate(date, timePattern)}`
}
