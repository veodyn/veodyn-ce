import { describe, expect, it } from 'vitest'
import { AppError } from '@/lib/errorIds'
import { assertSafeSqlIdentifier, isNumericSqlType, isSafeSqlIdentifier, quoteSqlLiteral } from './sql-safety'

// Every one of these has to be refused as an identifier. They are the shapes a
// field name would have to take to break out of its syntactic position.
const ATTACK_IDENTIFIERS: Array<[label: string, value: string]> = [
  ['single quote', "route_id'"],
  ['doubled quote', "route_id''"],
  ['double quote', 'route_id"'],
  ['backtick', 'route_id`'],
  ['semicolon', 'route_id;'],
  ['statement append', 'route_id; DROP TABLE users'],
  ['line comment', 'route_id--'],
  ['spaced line comment', 'route_id -- comment'],
  ['block comment', 'route_id/*x*/'],
  ['open block comment', 'route_id/*'],
  ['newline union', 'route_id\nUNION SELECT 1'],
  ['carriage return', 'route_id\r\n'],
  ['trailing space', 'route_id '],
  ['leading space', ' route_id'],
  ['inner space', 'route id'],
  ['leading digit', '1route'],
  ['bare digits', '1'],
  ['star', '*'],
  ['empty', ''],
  ['nul byte', 'route_id\u0000'],
  ['shell substitution', '$(whoami)'],
  ['concat operator', 'route_id||1'],
  ['paren call', 'sleep(1)'],
  ['over length', 'a'.repeat(200)],
  ['dotted with attack tail', "ds.route_id'"],
  ['empty part', 'ds..route_id'],
]

describe('isSafeSqlIdentifier', () => {
  it('accepts plain and dataset-qualified identifiers', () => {
    expect(isSafeSqlIdentifier('route_id')).toBe(true)
    expect(isSafeSqlIdentifier('_private1')).toBe(true)
    expect(isSafeSqlIdentifier('bus_ridership_daily.route_id')).toBe(true)
  })

  it('rejects more parts than allowed', () => {
    expect(isSafeSqlIdentifier('a.b.c')).toBe(false)
    expect(isSafeSqlIdentifier('a.b', 1)).toBe(false)
    expect(isSafeSqlIdentifier('a.b.c', 3)).toBe(true)
  })

  it.each(ATTACK_IDENTIFIERS)('rejects %s', (_label, value) => {
    expect(isSafeSqlIdentifier(value)).toBe(false)
  })

  it('rejects non-string input that slipped past the type checker', () => {
    expect(isSafeSqlIdentifier(undefined as unknown as string)).toBe(false)
    expect(isSafeSqlIdentifier(42 as unknown as string)).toBe(false)
  })
})

describe('assertSafeSqlIdentifier', () => {
  it('returns the identifier unchanged when it is safe', () => {
    expect(assertSafeSqlIdentifier('route_id', 'dimension')).toBe('route_id')
  })

  it.each(ATTACK_IDENTIFIERS)('throws an AppError for %s', (_label, value) => {
    expect(() => assertSafeSqlIdentifier(value, 'dimension')).toThrow(AppError)
    expect(() => assertSafeSqlIdentifier(value, 'dimension')).toThrow(/dimension/)
  })
})

// Reverses the escaping quoteSqlLiteral applies, so a test can assert the
// literal still means exactly what the user typed.
function unquote(literal: string): string {
  expect(literal.startsWith("'")).toBe(true)
  expect(literal.endsWith("'")).toBe(true)
  return literal.slice(1, -1).replace(/''/g, "'").replace(/\\\\/g, '\\')
}

describe('quoteSqlLiteral', () => {
  const VALUES = [
    "O'Brien",
    "x'; DROP TABLE users; --",
    "'; SELECT 1; --",
    "') OR ('1'='1",
    'ends with a backslash \\',
    'C:\\path\\to\\file',
    'line one\nline two',
    'plain text',
    '2026-01-01',
    '100',
    '',
    '%wildcard%',
  ]

  it.each(VALUES)('wraps %j in exactly one literal that round-trips', (value) => {
    const literal = quoteSqlLiteral(value)
    expect(unquote(literal)).toBe(value)
    // No unescaped quote and no unescaped backslash can survive inside.
    expect(literal.slice(1, -1).replace(/''/g, '').replace(/\\\\/g, '')).not.toMatch(/['\\]/)
  })

  it('doubles the quote rather than dropping it', () => {
    expect(quoteSqlLiteral("O'Brien")).toBe("'O''Brien'")
  })

  it('doubles a trailing backslash so it cannot escape the closing quote', () => {
    expect(quoteSqlLiteral('abc\\')).toBe("'abc\\\\'")
  })

  it('rejects a NUL byte', () => {
    expect(() => quoteSqlLiteral('a\u0000b')).toThrow(AppError)
  })

  it('rejects non-string input that slipped past the type checker', () => {
    expect(() => quoteSqlLiteral({} as unknown as string)).toThrow(AppError)
  })
})

describe('isNumericSqlType', () => {
  it('recognises the numeric families the catalog emits', () => {
    for (const t of ['integer', 'int', 'Int64', 'UInt32', 'float', 'float8', 'double precision', 'decimal(10,2)', 'numeric', 'number', 'serial', 'bigint', 'real']) {
      expect(isNumericSqlType(t)).toBe(true)
    }
  })

  it('unwraps ClickHouse type wrappers', () => {
    expect(isNumericSqlType('Nullable(Int32)')).toBe(true)
    expect(isNumericSqlType('LowCardinality(String)')).toBe(false)
  })

  it('does not treat an array of a numeric element as a numeric column', () => {
    // Array(Int32) is not a number: aggregating it with sum() is a type error.
    // Only nullability / cardinality wrappers are transparent; arrays are not.
    expect(isNumericSqlType('Array(Int32)')).toBe(false)
    expect(isNumericSqlType('Array(Float64)')).toBe(false)
    expect(isNumericSqlType('Nullable(Array(Int32))')).toBe(false)
  })

  it('does not treat text, date, or boolean types as numeric', () => {
    for (const t of ['string', 'text', 'varchar(20)', 'date', 'datetime', 'timestamp', 'boolean', 'object', '']) {
      expect(isNumericSqlType(t)).toBe(false)
    }
  })
})
