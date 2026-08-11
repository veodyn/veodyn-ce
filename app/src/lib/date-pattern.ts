// The display formats an operator picks in Settings > Formats, as patterns a
// chart can use: reshaped to the precision an axis is drawing at, and rendered
// against an instant's UTC components.
//
// Two things live here because a chart needs both and neither belongs in
// format-datetime.ts:
//
//   * **Reshaping.** A time axis stepping in days already states the year on its
//     second line, so its tick labels want the configured date pattern minus the
//     year, not a second pattern invented here. The rule the whole module serves
//     is that the SETTING decides the form (field order, separators, 12h versus
//     24h) and the axis's own span decides the precision.
//   * **Rendering in UTC.** chart-time-axis.ts places ticks on round UTC
//     boundaries, because parseDateValue reads a naive backend timestamp as UTC.
//     format-datetime.ts renders in local time, which is right for a table cell
//     and wrong here: it would slide every label off the boundary its tick sits
//     on. Rebuilding a local Date from UTC components and formatting that would
//     mostly work, but a local time that does not exist (02:30 in a zone that
//     springs forward at 02:00) is normalised an hour forward, so one day a year
//     the axis would label a tick as the wrong hour. The tokens are read
//     directly off the UTC components instead, so no zone is ever involved.

import { DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT } from './format-datetime'

/**
 * The two moment-style patterns Settings > Formats stores. Named to match
 * `Formats` (use-formats.ts), which extends this, so the hook's value can be
 * handed straight to anything asking for patterns.
 */
export interface DisplayPatterns {
  dateFormat: string
  timeFormat: string
}

export const DEFAULT_DISPLAY_PATTERNS: DisplayPatterns = {
  dateFormat: DEFAULT_DATE_FORMAT,
  timeFormat: DEFAULT_TIME_FORMAT,
}

const YEAR_TOKEN = /Y+/
const DAY_TOKEN = /D+/
const SECOND_TOKEN = /s+/

// The separator to introduce seconds with when the configured pattern has none
// and no separator can be copied from the minutes field.
const SECOND_SEPARATOR = ':'

// A field, plus the separator that led into it. Removing both keeps 'DD/MM/YY'
// from becoming 'DD/MM/' when the year goes.
function dropField(pattern: string, token: RegExp): string {
  const remaining = pattern.replace(new RegExp(`[^A-Za-z]*${token.source}`), '')
  // A field at the start of the pattern has its separator on the other side, so
  // 'YYYY-MM-DD' leaves a leading '-' the first pass could not have taken.
  return remaining.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z]+$/, '')
}

/** The date pattern without its year: for ticks whose year is stated elsewhere. */
export function withoutYear(pattern: string): string {
  return dropField(pattern, YEAR_TOKEN)
}

/** The date pattern without its day: for an axis stepping in months. */
export function withoutDay(pattern: string): string {
  return dropField(pattern, DAY_TOKEN)
}

/**
 * Just the year, as the pattern writes it. A two-digit setting keeps its two
 * digits here rather than being widened: an operator who reads every other date
 * in the product as 07/25/26 is not helped by one axis that disagrees.
 */
export function yearOnly(pattern: string): string {
  return YEAR_TOKEN.exec(pattern)?.[0] ?? 'YYYY'
}

/**
 * The time pattern without seconds. An axis stepping in minutes would otherwise
 * print ":00" under every tick, three characters that carry nothing and cost
 * ticks: recharts drops labels that no longer clear minTickGap.
 */
export function withoutSeconds(pattern: string): string {
  return dropField(pattern, SECOND_TOKEN)
}

/**
 * The time pattern with seconds, for an axis (or a value) whose precision is
 * finer than a minute. The separator is the one the pattern already uses before
 * its minutes, so 'HH:mm' and 'HH.mm' each keep their own punctuation.
 */
export function withSeconds(pattern: string): string {
  if (SECOND_TOKEN.test(pattern)) return pattern
  return pattern.replace(
    /([^A-Za-z]?)(m+)/,
    (_match, separator: string, minutes: string) =>
      `${separator}${minutes}${separator || SECOND_SEPARATOR}ss`,
  )
}

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const MONTHS_SHORT = MONTHS_LONG.map((month) => month.slice(0, 3))

// Longest form of each field first, so 'YYYY' is not read as 'YY' twice. The
// bracket alternative is moment's escape for literal text; the pattern set in
// Settings has none, but honouring it costs one branch and a stored pattern
// from Redash itself may carry one.
const MOMENT_TOKEN = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|H|hh|h|mm|m|ss|s|A|a/g

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * An instant rendered against a moment-style pattern, reading its **UTC**
 * components.
 *
 * A second interpreter of the same token vocabulary as format-datetime.ts's
 * translation table, and deliberately so: that one hands the pattern to date-fns
 * to render in local time, which no axis can use (see the module header). The
 * two must agree on what a token means, not on where the fields land.
 */
export function formatUtcPattern(ts: number, pattern: string): string {
  if (!Number.isFinite(ts)) return ''
  const date = new Date(ts)
  const hours24 = date.getUTCHours()
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12

  return pattern.replace(MOMENT_TOKEN, (token: string, literal?: string) => {
    if (literal != null) return literal
    switch (token) {
      case 'YYYY': return String(date.getUTCFullYear())
      case 'YY': return pad2(date.getUTCFullYear() % 100)
      case 'MMMM': return MONTHS_LONG[date.getUTCMonth()]
      case 'MMM': return MONTHS_SHORT[date.getUTCMonth()]
      case 'MM': return pad2(date.getUTCMonth() + 1)
      case 'M': return String(date.getUTCMonth() + 1)
      case 'DD': return pad2(date.getUTCDate())
      case 'D': return String(date.getUTCDate())
      case 'HH': return pad2(hours24)
      case 'H': return String(hours24)
      case 'hh': return pad2(hours12)
      case 'h': return String(hours12)
      case 'mm': return pad2(date.getUTCMinutes())
      case 'm': return String(date.getUTCMinutes())
      case 'ss': return pad2(date.getUTCSeconds())
      case 's': return String(date.getUTCSeconds())
      case 'A': return hours24 < 12 ? 'AM' : 'PM'
      case 'a': return hours24 < 12 ? 'am' : 'pm'
      default: return token
    }
  })
}
