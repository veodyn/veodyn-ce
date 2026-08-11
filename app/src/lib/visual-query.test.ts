import { describe, expect, it } from 'vitest'
import { compileVisualQuery, needsJoin } from './visual-query'
import type { AiDatasetColumn, VisualQuerySpec } from '@/types/ai'

const spec: VisualQuerySpec = {
  dataset: 'bus_ridership_daily',
  dimensions: ['route_id'],
  aggregates: [{ column: 'boardings', fn: 'sum', alias: 'total_boardings' }],
  filters: [{ column: 'service_date', op: '>=', value: '2026-01-01' }],
  sort: [{ column: 'total_boardings', dir: 'desc' }],
  limit: 100,
  chartType: 'CHART',
}

const columns: AiDatasetColumn[] = [
  { name: 'service_date', type: 'date' },
  { name: 'route_id', type: 'string' },
  { name: 'boardings', type: 'integer' },
]

describe('compileVisualQuery', () => {
  it('composes GROUP BY / aggregate / WHERE / ORDER BY / LIMIT deterministically', () => {
    const sql = compileVisualQuery(spec)
    expect(sql).toContain('SELECT route_id, sum(boardings) AS total_boardings')
    expect(sql).toContain('FROM bus_ridership_daily')
    expect(sql).toContain("WHERE service_date >= '2026-01-01'")
    expect(sql).toContain('GROUP BY route_id')
    expect(sql).toContain('ORDER BY total_boardings desc')
    expect(sql).toContain('LIMIT 100')
  })

  it('returns the identical string for the identical spec', () => {
    expect(compileVisualQuery(spec)).toBe(compileVisualQuery(spec))
  })

  it('selects * for an empty spec', () => {
    const empty = { dataset: 'trips' } as VisualQuerySpec
    expect(compileVisualQuery(empty)).toBe('SELECT *\nFROM trips')
  })

  it('selects * when the spec has filters but no fields', () => {
    const onlyFilters = {
      ...spec,
      dimensions: [],
      aggregates: [],
      sort: [],
      limit: 0,
    }
    expect(compileVisualQuery(onlyFilters)).toBe("SELECT *\nFROM bus_ridership_daily\nWHERE service_date >= '2026-01-01'")
  })

  it('keeps a filter on a column that is not in the select list out of the select list', () => {
    const sql = compileVisualQuery({ ...spec, filters: [{ column: 'vehicle_id', op: '=', value: 'BUS-9' }] })
    expect(sql).toContain('SELECT route_id, sum(boardings) AS total_boardings')
    expect(sql).toContain("WHERE vehicle_id = 'BUS-9'")
    expect(sql).not.toContain('SELECT vehicle_id')
  })

  it('omits GROUP BY when there is no aggregate and omits LIMIT when there is no limit', () => {
    const sql = compileVisualQuery({ ...spec, aggregates: [], sort: [], limit: 0 })
    expect(sql).toBe("SELECT route_id\nFROM bus_ridership_daily\nWHERE service_date >= '2026-01-01'")
  })

  it('joins several filters with AND and several sorts with a comma', () => {
    const sql = compileVisualQuery({
      ...spec,
      filters: [
        { column: 'service_date', op: '>=', value: '2026-01-01' },
        { column: 'route_id', op: 'like', value: 'R%' },
      ],
      sort: [
        { column: 'total_boardings', dir: 'desc' },
        { column: 'route_id', dir: 'asc' },
      ],
    })
    expect(sql).toContain("WHERE service_date >= '2026-01-01' AND route_id like 'R%'")
    expect(sql).toContain('ORDER BY total_boardings desc, route_id asc')
  })

  it('emits a numeric filter value bare and everything else as a quoted literal', () => {
    const sql = compileVisualQuery({ ...spec, filters: [{ column: 'boardings', op: '>', value: '250' }] })
    expect(sql).toContain('WHERE boardings > 250')
    const text = compileVisualQuery({ ...spec, filters: [{ column: 'route_id', op: '=', value: '250A' }] })
    expect(text).toContain("WHERE route_id = '250A'")
  })

  it('allows count(*)', () => {
    const sql = compileVisualQuery({
      ...spec,
      aggregates: [{ column: '*', fn: 'count', alias: 'trips' }],
      sort: [],
    })
    expect(sql).toContain('SELECT route_id, count(*) AS trips')
  })

  it('accepts a dataset-qualified column and a database-qualified dataset', () => {
    const sql = compileVisualQuery({
      ...spec,
      dataset: 'transit.bus_ridership_daily',
      dimensions: ['transit.bus_ridership_daily.route_id'],
      aggregates: [],
      sort: [],
      filters: [],
    })
    expect(sql).toContain('SELECT transit.bus_ridership_daily.route_id')
    expect(sql).toContain('FROM transit.bus_ridership_daily')
  })
})

describe('compileVisualQuery with a schema allowlist', () => {
  it('compiles when every referenced column is in the schema', () => {
    expect(compileVisualQuery(spec, { columns })).toContain('FROM bus_ridership_daily')
  })

  it('rejects a dimension, aggregate, filter, or sort column that is not in the schema', () => {
    expect(() => compileVisualQuery({ ...spec, dimensions: ['ghost'] }, { columns })).toThrow(/ghost/)
    expect(() =>
      compileVisualQuery({ ...spec, aggregates: [{ column: 'ghost', fn: 'sum', alias: 'x' }], sort: [] }, { columns })
    ).toThrow(/ghost/)
    expect(() =>
      compileVisualQuery({ ...spec, filters: [{ column: 'ghost', op: '=', value: 'x' }] }, { columns })
    ).toThrow(/ghost/)
    expect(() => compileVisualQuery({ ...spec, sort: [{ column: 'ghost', dir: 'asc' }] }, { columns })).toThrow(/ghost/)
  })

  it('lets ORDER BY reference an aggregate alias or a selected dimension', () => {
    const sql = compileVisualQuery(spec, { columns })
    expect(sql).toContain('ORDER BY total_boardings desc')
    expect(compileVisualQuery({ ...spec, sort: [{ column: 'route_id', dir: 'asc' }] }, { columns })).toContain(
      'ORDER BY route_id asc'
    )
  })

  it('rejects a non-numeric value for a numeric column', () => {
    expect(() =>
      compileVisualQuery({ ...spec, filters: [{ column: 'boardings', op: '>', value: '1 OR 1=1' }] }, { columns })
    ).toThrow(/boardings/)
    expect(
      compileVisualQuery({ ...spec, filters: [{ column: 'boardings', op: '>', value: '250' }] }, { columns })
    ).toContain('WHERE boardings > 250')
  })

  it('quotes a numeric-looking value for a text column when the schema is known', () => {
    expect(
      compileVisualQuery({ ...spec, filters: [{ column: 'route_id', op: '=', value: '250' }] }, { columns })
    ).toContain("WHERE route_id = '250'")
  })

  // A date column had no rule of its own, so anything was quoted as a plain
  // string: `captured_at >= 2026` compiled, ran, and came back as
  // CANNOT_PARSE_DATETIME from ClickHouse.
  it('rejects a value that is not a date for a date column', () => {
    const filters = (value: string) => ({
      ...spec,
      filters: [{ column: 'service_date' as const, op: '>=' as const, value }],
    })

    expect(() => compileVisualQuery(filters('2026'), { columns })).toThrow(/needs a date/)
    expect(() => compileVisualQuery(filters('07/22/2026'), { columns })).toThrow(/needs a date/)
    expect(() => compileVisualQuery(filters('last tuesday'), { columns })).toThrow(/needs a date/)
  })

  it('normalises a datetime to the form every engine parses', () => {
    const withTime = [{ name: 'captured_at', type: "DateTime64(3, 'UTC')" }, ...columns]
    const at = (value: string) => ({
      ...spec,
      filters: [{ column: 'captured_at' as const, op: '>=' as const, value }],
    })

    // What <input type="datetime-local"> produces, which ClickHouse's DateTime
    // parser takes only on newer builds.
    expect(compileVisualQuery(at('2026-07-22T15:22'), { columns: withTime })).toContain(
      "WHERE captured_at >= '2026-07-22 15:22:00'"
    )
    expect(compileVisualQuery(at('2026-07-22 15:22:25'), { columns: withTime })).toContain(
      "WHERE captured_at >= '2026-07-22 15:22:25'"
    )
    expect(() => compileVisualQuery(at('2026'), { columns: withTime })).toThrow(/needs a date/)
  })

  it('sees through a Nullable wrapper on a date column', () => {
    const wrapped = [{ name: 'ended_at', type: 'Nullable(DateTime)' }, ...columns]

    expect(() =>
      compileVisualQuery(
        { ...spec, filters: [{ column: 'ended_at', op: '>=', value: 'soon' }] },
        { columns: wrapped }
      )
    ).toThrow(/needs a date/)
  })
})

describe('needsJoin', () => {
  it('is false for a single-dataset spec and true when a field names another dataset', () => {
    expect(needsJoin(spec)).toBe(false)
    expect(needsJoin({ ...spec, dimensions: ['route_id', 'other_dataset.region'] })).toBe(true)
  })

  it('also catches another dataset named by an aggregate, a filter, or a sort', () => {
    expect(needsJoin({ ...spec, aggregates: [{ column: 'other.boardings', fn: 'sum', alias: 'x' }] })).toBe(true)
    expect(needsJoin({ ...spec, filters: [{ column: 'other.service_date', op: '>=', value: '2026-01-01' }] })).toBe(true)
    expect(needsJoin({ ...spec, sort: [{ column: 'other.total', dir: 'desc' }] })).toBe(true)
  })

  it('does not count a self-qualified column as a join', () => {
    expect(needsJoin({ ...spec, dimensions: ['bus_ridership_daily.route_id'] })).toBe(false)
  })

  it('flags a deeper-qualified field whose full prefix is not the dataset', () => {
    // dataset `sales`, field `sales.archive.amount`: the leading part matches
    // but the full qualifier (`sales.archive`) is another table, so a plain
    // startsWith check wrongly cleared it. The prefix must equal the dataset.
    const sales = { dataset: 'sales' } as VisualQuerySpec
    expect(needsJoin({ ...sales, dimensions: ['sales.archive.amount'] })).toBe(true)
    expect(needsJoin({ ...sales, aggregates: [{ column: 'sales.archive.amount', fn: 'sum', alias: 'x' }] })).toBe(true)
    // The one-level self-qualified form is still fine.
    expect(needsJoin({ ...sales, dimensions: ['sales.amount'] })).toBe(false)
  })

  it('refuses to compile a deeper-qualified cross-table field', () => {
    const sales = { dataset: 'sales', dimensions: ['sales.archive.amount'] } as VisualQuerySpec
    const salesColumns: AiDatasetColumn[] = [{ name: 'amount', type: 'integer' }]
    expect(() => compileVisualQuery(sales, { columns: salesColumns })).toThrow(/more than one dataset/)
  })

  it('tolerates a spec with missing arrays', () => {
    expect(needsJoin({ dataset: 'trips' } as VisualQuerySpec)).toBe(false)
  })
})
