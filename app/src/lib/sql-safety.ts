// SQL safety primitives shared by the deterministic SQL composers (the Visual
// query compiler and the AI mock generator).
//
// Both composers build SQL text out of names and values that originate in the
// browser (a field picker, a grounding payload posted to /api/ai/*), so nothing
// may reach the SQL string by concatenation alone. Two rules:
//
//   1. Anything in an identifier position (dataset, column, alias) is matched
//      against a strict allowlist pattern and REFUSED if it does not match.
//      Identifiers are emitted bare, so validation is the only thing standing
//      between a field name and the parser: no engine-specific quoting style
//      (double quote, backtick) is assumed.
//   2. Anything in a value position is emitted as a single quoted literal with
//      the quote and the backslash escaped, so a payload cannot terminate the
//      literal it sits in. ClickHouse honours backslash escapes inside string
//      literals, hence the backslash doubling and not just the quote doubling.
//
// Callers with schema metadata should additionally check names against the real
// column list (see compileVisualQuery's `columns` option). This module is the
// floor, not the ceiling.

import { AppError, ErrorIds } from '@/lib/errorIds'

// One dot-separated part of an identifier: ASCII, leading letter or underscore,
// 63 characters at most (the Postgres identifier limit; ClickHouse is looser).
const IDENTIFIER_PART = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/

// Numeric column families, matched on the normalised base type. Deliberately
// exact so near-misses ("interval", "string") do not read as numeric: a wrong
// "numeric" verdict would let a value through unquoted.
const NUMERIC_TYPE =
  /^(?:u?int\d*|integer|tinyint|smallint|mediumint|bigint|float\d*|double(?: precision)?|decimal|numeric|number|real|u?serial\d*|bigserial|smallserial|money|fixed)$/

// Date/time column families, matched the same exact way. ClickHouse's Date32
// and DateTime64 carry their precision in parentheses, which baseSqlType has
// already stripped by the time this is tested.
const DATE_TYPE = /^(?:date\d*|datetime\d*|timestamp(?: with(?:out)? time zone)?|smalldatetime)$/

// A date, optionally with a time, in the one shape every engine here parses.
// Deliberately strict: a partial value like "2026" or "07/22/2026" is refused
// rather than guessed at.
const DATE_LITERAL = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?$/

// Nullability / cardinality wrappers the catalog carries through from
// ClickHouse. These are transparent: the element type decides numericness.
// `Array(...)` is deliberately NOT here, so an Array(Int32) does not read as a
// numeric column and never gets aggregated with sum().
const TYPE_WRAPPER = /^(?:nullable|lowcardinality)\((.*)\)$/

// Written without an escape sequence on purpose: a literal NUL in source is
// invisible in review and easy to mangle in transit.
const NUL = String.fromCharCode(0)

export function sqlSafetyError(message: string, context: Record<string, unknown> = {}): AppError {
  return new AppError(ErrorIds.AI_SPEC_INVALID, message, context)
}

// Truncated so a hostile name cannot flood a log line or a UI notice.
function forLog(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value)
  return text.length > 80 ? `${text.slice(0, 80)}...` : text
}

/** True when `name` is a bare (optionally dot-qualified) identifier safe to emit unquoted. */
export function isSafeSqlIdentifier(name: string, maxParts = 2): boolean {
  if (typeof name !== 'string' || name.length === 0) return false
  const parts = name.split('.')
  if (parts.length > maxParts) return false
  return parts.every((part) => IDENTIFIER_PART.test(part))
}

/** Returns `name` when it is a safe identifier, otherwise refuses it by throwing. */
export function assertSafeSqlIdentifier(name: string, role: string, maxParts = 2): string {
  if (!isSafeSqlIdentifier(name, maxParts)) {
    throw sqlSafetyError(`Rejected an unsafe SQL identifier in the ${role} position: "${forLog(name)}"`, {
      role,
      value: forLog(name),
    })
  }
  return name
}

/** True when `value` is a plain number literal, safe to emit without quotes. */
export function isNumericLiteral(value: string): boolean {
  return typeof value === 'string' && /^-?(?:\d+|\d*\.\d+)$/.test(value)
}

/** Wraps `value` in exactly one SQL string literal, escaping quote and backslash. */
export function quoteSqlLiteral(value: string): string {
  if (typeof value !== 'string') {
    throw sqlSafetyError('Rejected a non-string SQL filter value', { value: forLog(value) })
  }
  if (value.includes(NUL)) {
    throw sqlSafetyError('Rejected a SQL filter value containing a NUL byte', { value: forLog(value) })
  }
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}

function baseSqlType(type: string): string {
  let normalised = typeof type === 'string' ? type.trim().toLowerCase() : ''
  for (let depth = 0; depth < 3; depth += 1) {
    const wrapped = TYPE_WRAPPER.exec(normalised)
    if (!wrapped) break
    normalised = wrapped[1].trim().toLowerCase()
  }
  return normalised.split('(')[0].trim()
}

/** True for the numeric column families, so a value can be required to be numeric. */
export function isNumericSqlType(type: string): boolean {
  return NUMERIC_TYPE.test(baseSqlType(type))
}

/** True for the date/time column families, so a value can be required to be a timestamp. */
export function isDateSqlType(type: string): boolean {
  return DATE_TYPE.test(baseSqlType(type))
}

/** True for a date with no time of day, which is a different control to pick. */
export function isDateOnlySqlType(type: string): boolean {
  return /^date\d*$/.test(baseSqlType(type))
}

/**
 * A date or timestamp a database will parse, normalised to the one form they
 * all accept: `YYYY-MM-DD` or `YYYY-MM-DD hh:mm:ss`. Null when the text is not
 * one.
 *
 * ClickHouse's DateTime parser takes the space-separated form; the `T` an
 * <input type="datetime-local"> produces is accepted by newer versions only, so
 * it is rewritten here rather than depending on the server's build. A bare year
 * ("2026") is refused: it is the shape that made a filter compile into valid
 * SQL and then fail at the database with CANNOT_PARSE_DATETIME.
 */
export function normalizeSqlDateLiteral(value: string): string | null {
  if (typeof value !== 'string') return null
  const match = DATE_LITERAL.exec(value.trim())
  if (!match) return null
  const [, date, time] = match
  if (time == null) return date
  // Seconds are optional in the input, required by nothing, and harmless to add.
  return `${date} ${time.length === 5 ? `${time}:00` : time}`
}
