// The display formats an operator picks in Settings > Formats, as patterns a
// chart can use: reshaped to the precision an axis is drawing at, and rendered
// against an instant's UTC components.
//
// The rule: the SETTING decides the form (field order, separators, 12h versus
// 24h) and the axis's own span decides the precision.
//
// Rendering is UTC because chart-time-axis.ts places ticks on round UTC
// boundaries (parseDateValue reads a naive backend timestamp as UTC).
// format-datetime.ts renders in local time, which would slide every label off
// its tick, and a local time that does not exist (02:30 where the zone springs
// forward at 02:00) normalises an hour forward. Tokens are read straight off the
// UTC components, so no zone is involved.

import { DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT } from './format-datetime'

/**
 * The two moment-style patterns Settings > Formats stores. Field names match
 * `Formats` (use-formats.ts), which extends this.
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
 * digits rather than being widened, so no axis disagrees with the rest of the UI.
 */
export function yearOnly(pattern: string): string {
  return YEAR_TOKEN.exec(pattern)?.[0] ?? 'YYYY'
}

/**
 * The time pattern without seconds. An axis stepping in minutes would otherwise
 * print ":00" under every tick, and recharts drops labels that no longer clear
 * minTickGap.
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
// bracket alternative is moment's escape for literal text, which a stored
// pattern from Redash itself may carry.
const MOMENT_TOKEN = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|H|hh|h|mm|m|ss|s|A|a/g

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * An instant rendered against a moment-style pattern, reading its **UTC**
 * components. A second interpreter of format-datetime.ts's token vocabulary
 * (that one renders in local time); the two must agree on what a token means.
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
