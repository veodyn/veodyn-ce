import { describe, expect, it } from 'vitest'
import type { QueryResultData } from '@/lib/mock-data'
import { CELL_CHARS, DISTINCT_CAP, SAMPLE_BYTES, shapeResult } from './shape-result'
import { failedResult } from './tool-results'

function result(rows: Record<string, unknown>[], columns: [string, string][]): QueryResultData {
  return { columns: columns.map(([name, type]) => ({ name, type, friendly_name: name })), rows }
}

const COLUMNS: [string, string][] = [
  ['route', 'string'],
  ['riders', 'integer'],
  ['day', 'date'],
]

describe('shapeResult', () => {
  it('sends a small result whole', () => {
    const shaped = shapeResult(
      result(
        [
          { route: 'A', riders: 10, day: '2026-09-02' },
          { route: 'B', riders: 3, day: '2026-09-01' },
          { route: 'A', riders: null, day: '2026-09-03' },
        ],
        COLUMNS
      )
    )
    expect(shaped.ok).toBe(true)
    expect(shaped.rowCount).toBe(3)
    expect(shaped.truncated).toBe(false)
    expect(shaped.sample).toHaveLength(3)
    expect(shaped.columns).toEqual([
      {
        name: 'route',
        type: 'string',
        nulls: 0,
        distinct: 2,
        distinctCapped: false,
        top: [
          { value: 'A', count: 2 },
          { value: 'B', count: 1 },
        ],
      },
      { name: 'riders', type: 'integer', nulls: 1, distinct: 2, distinctCapped: false, min: 3, max: 10 },
      { name: 'day', type: 'date', nulls: 0, distinct: 3, distinctCapped: false, min: '2026-09-01', max: '2026-09-03' },
    ])
  })

  it('samples fifty rows and computes statistics over all of them', () => {
    const rows = Array.from({ length: 12_400 }, (_, n) => ({ route: `R${n % 47}`, riders: n, day: '2026-09-01' }))
    const shaped = shapeResult(result(rows, COLUMNS))
    expect(shaped.rowCount).toBe(12_400)
    expect(shaped.truncated).toBe(true)
    expect(shaped.sample).toHaveLength(50)
    expect(shaped.columns?.[1]).toMatchObject({ min: 0, max: 12_399 })
    expect(shaped.columns?.[0].distinct).toBe(47)
  })

  it('keeps the sample under its byte budget', () => {
    const names = ['a', 'b', 'c', 'd', 'e']
    const rows = Array.from({ length: 50 }, () => Object.fromEntries(names.map((name) => [name, 'x'.repeat(190)])))
    const shaped = shapeResult(result(rows, names.map((name) => [name, 'string'] as [string, string])))
    expect(new TextEncoder().encode(JSON.stringify(shaped.sample)).byteLength).toBeLessThanOrEqual(SAMPLE_BYTES)
    expect(shaped.sample?.length).toBeLessThan(50)
    expect(shaped.sample?.length).toBeGreaterThan(20)
    expect(shaped.truncated).toBe(true)
  })

  it('trims long cells', () => {
    const shaped = shapeResult(result([{ note: 'n'.repeat(1_000) }], [['note', 'string']]))
    const cell = String(shaped.sample?.[0].note)
    expect(cell).toHaveLength(CELL_CHARS + 1)
    expect(cell.endsWith('…')).toBe(true)
    expect(String(shaped.columns?.[0].top?.[0].value)).toHaveLength(CELL_CHARS + 1)
  })

  it('caps the distinct count', () => {
    const rows = Array.from({ length: DISTINCT_CAP + 5 }, (_, n) => ({ id: `v${n}` }))
    const [column] = shapeResult(result(rows, [['id', 'string']])).columns ?? []
    expect(column.distinct).toBe(DISTINCT_CAP)
    expect(column.distinctCapped).toBe(true)
  })

  it('only sends the result columns', () => {
    const shaped = shapeResult(result([{ route: 'A', hidden: 'secret' }], [['route', 'string']]))
    expect(shaped.sample).toEqual([{ route: 'A' }])
  })

  it('handles an empty result', () => {
    expect(shapeResult(result([], COLUMNS))).toMatchObject({ rowCount: 0, truncated: false, sample: [] })
  })
})

describe('failedResult', () => {
  it('carries a trimmed message', () => {
    expect(failedResult('query_result', new Error('e'.repeat(900)))).toEqual({
      kind: 'query_result',
      ok: false,
      error: 'e'.repeat(500),
    })
    expect(failedResult('library', '')).toEqual({ kind: 'library', ok: false, error: 'The request failed.' })
  })
})
