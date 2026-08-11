import { describe, expect, it } from 'vitest'
import type { QueryResultData } from '@/lib/mock-data'
import { buildCohortModel } from './cohort-model'

const options = { dateColumn: 'date', stageColumn: 'stage', totalColumn: 'total', valueColumn: 'value' }

// Stages start at 1, not 0, so this fixture also exercises the observed
// (not zero-based) stage axis: the model must not invent a phantom stage 0.
const data: QueryResultData = {
  columns: [
    { name: 'date', friendly_name: 'date', type: 'string' },
    { name: 'stage', friendly_name: 'stage', type: 'integer' },
    { name: 'total', friendly_name: 'total', type: 'integer' },
    { name: 'value', friendly_name: 'value', type: 'integer' },
  ],
  rows: [
    { date: '2026-01-01', stage: 1, total: 100, value: 100 },
    { date: '2026-01-01', stage: 2, total: 100, value: 40 },
    { date: '2026-01-08', stage: 1, total: 80, value: 80 },
  ],
}

describe('buildCohortModel', () => {
  it('builds a contiguous axis over the observed stage range, not a zero-based one', () => {
    const model = buildCohortModel(options, data)
    expect(model.stages).toEqual([1, 2])
  })

  it('groups rows into cohort x stage cells aligned to the observed axis', () => {
    const model = buildCohortModel(options, data)
    expect(model.rows).toHaveLength(2)
    // Rows sort by cohort key ascending, so index 0 is 2026-01-01 and index 1
    // is 2026-01-08.
    expect(model.rows[0]).toEqual({ key: '2026-01-01', total: 100, values: [100, 40] })
    expect(model.rows[1]).toEqual({ key: '2026-01-08', total: 80, values: [80, null] })
  })

  it('sorts rows by cohort key ascending', () => {
    const model = buildCohortModel(options, data)
    expect(model.rows.map((r) => r.key)).toEqual(['2026-01-01', '2026-01-08'])
  })

  it('leaves a cell null when a cohort has no row for a given stage', () => {
    const model = buildCohortModel(options, data)
    expect(model.rows[1].values[1]).toBe(null)
  })

  it('builds a contiguous axis over a stage range that includes a negative stage', () => {
    const withNegative: QueryResultData = {
      columns: data.columns,
      rows: [
        { date: '2026-01-01', stage: -1, total: 100, value: 20 },
        { date: '2026-01-01', stage: 1, total: 100, value: 60 },
      ],
    }
    const model = buildCohortModel(options, withNegative)
    expect(model.stages).toEqual([-1, 0, 1])
    expect(model.rows[0].values).toEqual([20, null, 60])
  })

  it('returns the empty model when required columns are missing', () => {
    const model = buildCohortModel({ dateColumn: 'date' }, data)
    expect(model.rows).toEqual([])
    expect(model.stages).toEqual([])
  })

  it('returns the empty model when no options are provided at all', () => {
    const model = buildCohortModel({}, data)
    expect(model.rows).toEqual([])
    expect(model.stages).toEqual([])
  })

  it('returns the empty model when no finite stage is observed', () => {
    const noFiniteStage: QueryResultData = {
      columns: data.columns,
      rows: [{ date: '2026-01-01', stage: Number.NaN, total: 100, value: 100 }],
    }
    const model = buildCohortModel(options, noFiniteStage)
    expect(model.rows).toEqual([])
    expect(model.stages).toEqual([])
  })

  it('does not throw and returns the clean degraded signal on empty row data', () => {
    const empty: QueryResultData = { columns: data.columns, rows: [] }
    expect(() => buildCohortModel(options, empty)).not.toThrow()
    const model = buildCohortModel(options, empty)
    expect(model.rows).toEqual([])
    expect(model.stages).toEqual([])
  })

  it('does not throw when required columns are missing entirely', () => {
    expect(() => buildCohortModel({ stageColumn: 'stage', valueColumn: 'value' }, data)).not.toThrow()
  })
})
