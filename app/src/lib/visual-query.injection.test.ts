import { describe, expect, it } from 'vitest'
import { compileVisualQuery, needsJoin } from './visual-query'
import { AppError } from '@/lib/errorIds'
import type { VisualAggFn, VisualFilter, VisualQuerySpec, VisualSort } from '@/types/ai'

// compileVisualQuery builds SQL from field-picker input, so every hostile shape
// a name or a value could take has to land somewhere harmless: refused outright
// (identifiers, structure) or confined to a string literal (filter values).
const spec: VisualQuerySpec = {
  dataset: 'bus_ridership_daily',
  dimensions: ['route_id'],
  aggregates: [{ column: 'boardings', fn: 'sum', alias: 'total_boardings' }],
  filters: [],
  sort: [],
  limit: 100,
  chartType: 'CHART',
}

const HOSTILE_NAMES = [
  "route_id'",
  'route_id"',
  'route_id`',
  'route_id; DROP TABLE users',
  'route_id -- comment',
  'route_id/* comment */',
  'route_id\nUNION SELECT password FROM users',
  '(SELECT password FROM users)',
  'route_id) FROM users; --',
  '1=1',
  '',
]

describe('identifier positions refuse hostile names', () => {
  it.each(HOSTILE_NAMES)('refuses %j as a dataset', (name) => {
    expect(() => compileVisualQuery({ ...spec, dataset: name })).toThrow(AppError)
  })

  it.each(HOSTILE_NAMES)('refuses %j as a dimension', (name) => {
    expect(() => compileVisualQuery({ ...spec, dimensions: [name] })).toThrow(AppError)
  })

  it.each(HOSTILE_NAMES)('refuses %j as an aggregate column', (name) => {
    expect(() => compileVisualQuery({ ...spec, aggregates: [{ column: name, fn: 'sum', alias: 'x' }] })).toThrow(AppError)
  })

  it.each(HOSTILE_NAMES)('refuses %j as an aggregate alias', (name) => {
    expect(() => compileVisualQuery({ ...spec, aggregates: [{ column: 'boardings', fn: 'sum', alias: name }] })).toThrow(
      AppError
    )
  })

  it.each(HOSTILE_NAMES)('refuses %j as a filter column', (name) => {
    expect(() => compileVisualQuery({ ...spec, filters: [{ column: name, op: '=', value: 'x' }] })).toThrow(AppError)
  })

  it.each(HOSTILE_NAMES)('refuses %j as a sort column', (name) => {
    expect(() => compileVisualQuery({ ...spec, sort: [{ column: name, dir: 'asc' }] })).toThrow(AppError)
  })

  it('refuses * outside count()', () => {
    expect(() => compileVisualQuery({ ...spec, dimensions: ['*'] })).toThrow(AppError)
    expect(() => compileVisualQuery({ ...spec, aggregates: [{ column: '*', fn: 'sum', alias: 'x' }] })).toThrow(AppError)
  })
})

describe('structural positions refuse values the type checker cannot police', () => {
  it('refuses an aggregate function outside the fixed set', () => {
    const fn = 'sum(x) FROM users; --' as unknown as VisualAggFn
    expect(() => compileVisualQuery({ ...spec, aggregates: [{ column: 'boardings', fn, alias: 'x' }] })).toThrow(AppError)
  })

  it('refuses a filter operator outside the fixed set', () => {
    const op = "= '' OR 1=1 --" as unknown as VisualFilter['op']
    expect(() => compileVisualQuery({ ...spec, filters: [{ column: 'route_id', op, value: 'x' }] })).toThrow(AppError)
  })

  it('refuses a sort direction outside the fixed set', () => {
    const dir = 'asc; DROP TABLE users' as unknown as VisualSort['dir']
    expect(() => compileVisualQuery({ ...spec, sort: [{ column: 'route_id', dir }] })).toThrow(AppError)
  })

  it('refuses a limit that is not a non-negative integer', () => {
    for (const limit of ['100; DROP TABLE users' as unknown as number, 1.5, -1, NaN, Infinity]) {
      expect(() => compileVisualQuery({ ...spec, limit })).toThrow(AppError)
    }
    expect(compileVisualQuery({ ...spec, limit: 0 })).not.toContain('LIMIT')
  })

  it('refuses a cross-dataset spec rather than compiling a broken join', () => {
    const joined = { ...spec, dimensions: ['other_dataset.region'] }
    expect(needsJoin(joined)).toBe(true)
    expect(() => compileVisualQuery(joined)).toThrow(/SQL editor/)
  })
})

describe('filter values stay inside their literal', () => {
  const HOSTILE_VALUES = [
    "'; DROP TABLE users; --",
    "x' OR '1'='1",
    "') OR ('1'='1",
    "O'Brien",
    'ends with a backslash \\',
    'multi\nline',
    '1; DROP TABLE users',
    '%_wildcards%',
  ]

  // Reads one string literal the way an engine would: a backslash escapes the
  // next character, a doubled quote is one quote, a lone quote ends the string.
  // Where this scanner says the literal ends is where the parser would say so.
  function readLiteral(sql: string, start: number): { value: string; end: number } {
    expect(sql[start]).toBe("'")
    let out = ''
    let i = start + 1
    while (i < sql.length) {
      const ch = sql[i]
      if (ch === '\\') {
        out += sql[i + 1] ?? ''
        i += 2
        continue
      }
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          out += "'"
          i += 2
          continue
        }
        return { value: out, end: i + 1 }
      }
      out += ch
      i += 1
    }
    throw new Error(`unterminated literal in: ${sql}`)
  }

  it.each(HOSTILE_VALUES)('confines %j to one quoted literal', (value) => {
    const sql = compileVisualQuery({ ...spec, filters: [{ column: 'route_id', op: '=', value }] })
    const prefix = 'WHERE route_id = '
    const { value: parsed, end } = readLiteral(sql, sql.indexOf(prefix) + prefix.length)
    // The payload survives as data, and the query resumes exactly where the
    // compiler intended: nothing of the value is left outside the quotes.
    expect(parsed).toBe(value)
    expect(sql.slice(end)).toBe('\nGROUP BY route_id\nLIMIT 100')
  })

  it('does not let a value forge a second statement', () => {
    const sql = compileVisualQuery({
      ...spec,
      filters: [{ column: 'route_id', op: '=', value: "x'; DELETE FROM users; --" }],
    })
    expect(sql).toBe(
      [
        'SELECT route_id, sum(boardings) AS total_boardings',
        'FROM bus_ridership_daily',
        "WHERE route_id = 'x''; DELETE FROM users; --'",
        'GROUP BY route_id',
        'LIMIT 100',
      ].join('\n')
    )
  })

  it('refuses a NUL byte in a filter value', () => {
    expect(() => compileVisualQuery({ ...spec, filters: [{ column: 'route_id', op: '=', value: 'a\u0000b' }] })).toThrow(
      AppError
    )
  })

  it('refuses a filter value that is not a string', () => {
    const value = { toString: () => "x' OR 1=1 --" } as unknown as string
    expect(() => compileVisualQuery({ ...spec, filters: [{ column: 'route_id', op: '=', value }] })).toThrow(AppError)
  })
})
