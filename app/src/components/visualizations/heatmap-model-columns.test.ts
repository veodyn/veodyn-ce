import { describe, expect, it } from 'vitest'
import type { QueryResultData } from '@/lib/mock-data'
import type { RedashHeatmapOptions } from '@/services/redash/types'
import { buildHeatmapModel, resolveColumns } from './heatmap-model'

// Column resolution against a stale mapping: an options.columnMapping entry
// naming a column the query no longer returns.
//
// The ruling this file pins: a mapping that is present and stale resolves to
// undefined and does not fall through to the positional fallback, because
// drawing the chart on columns the author did not choose is a quiet lie. That
// undefined flows into buildHeatmapModel's required-columns guard, so the
// renderer shows its empty state. The unmapped case keeps its positional
// fallback (heatmap-model.test.ts), and one test below pins the two apart.

const columns: QueryResultData['columns'] = [
  { name: 'weekday', friendly_name: 'weekday', type: 'string' },
  { name: 'period', friendly_name: 'period', type: 'string' },
  { name: 'count', friendly_name: 'count', type: 'integer' },
]

const data: QueryResultData = {
  columns,
  rows: [
    { weekday: 'Monday', period: 'Morning', count: 10 },
    { weekday: 'Tuesday', period: 'Evening', count: 34 },
  ],
}

describe('resolveColumns against a stale mapping', () => {
  it('resolves a mapped column that the result set does not carry to undefined', () => {
    // Asserted directly, not only through buildHeatmapModel's null: the ruling
    // is that this resolves to undefined rather than data.columns[0], and a null
    // model cannot tell that apart from a guard rejecting for another reason.
    const stale: RedashHeatmapOptions = { columnMapping: { renamed_weekday: 'x', period: 'y', count: 'value' } }
    expect(resolveColumns(stale, data).xCol).toBeUndefined()
  })

  it('does not fall through to the positional fallback for the stale role', () => {
    const stale: RedashHeatmapOptions = { columnMapping: { renamed_weekday: 'x', period: 'y', count: 'value' } }
    const resolved = resolveColumns(stale, data)
    expect(resolved.xCol).not.toBe('weekday')
    // The roles whose mapping is still good are untouched.
    expect(resolved.yCol).toBe('period')
    expect(resolved.valueCol).toBe('count')
  })

  it('keeps resolving the unmapped case positionally, which is a different case', () => {
    const resolved = resolveColumns({}, data)
    expect(resolved.xCol).toBe('weekday')
    expect(resolved.yCol).toBe('period')
    expect(resolved.valueCol).toBe('count')
  })
})

describe('buildHeatmapModel against a stale mapping', () => {
  it('returns null when the x mapping names a column the result no longer has', () => {
    const model = buildHeatmapModel(
      { columnMapping: { renamed_weekday: 'x', period: 'y', count: 'value' } },
      data
    )
    expect(model).toBeNull()
  })

  it('returns null when the y mapping names a column the result no longer has', () => {
    const model = buildHeatmapModel(
      { columnMapping: { weekday: 'x', renamed_period: 'y', count: 'value' } },
      data
    )
    expect(model).toBeNull()
  })

  it('returns null when the value mapping names a column the result no longer has', () => {
    const model = buildHeatmapModel(
      { columnMapping: { weekday: 'x', period: 'y', renamed_count: 'value' } },
      data
    )
    expect(model).toBeNull()
  })

  it('still builds when the stale mapping is the value one and the aggregation is count', () => {
    // count consults no value column at all, so a stale value mapping costs it
    // nothing and the chart is still the chart the author asked for.
    const model = buildHeatmapModel(
      { columnMapping: { weekday: 'x', period: 'y', renamed_count: 'value' }, aggregation: 'count' },
      data
    )
    expect(model).not.toBeNull()
    expect(model?.xCategories).toEqual(['Monday', 'Tuesday'])
  })

  it('never collapses the rows into a single category named undefined', () => {
    // The observable symptom of the bug: a non-null model whose x axis was
    // exactly ['undefined'].
    const model = buildHeatmapModel(
      { columnMapping: { renamed_weekday: 'x', period: 'y', count: 'value' } },
      data
    )
    expect(model?.xCategories ?? []).not.toContain('undefined')
  })

  it('keeps a category genuinely named undefined as its own category', () => {
    // The other half: 'undefined' is a legal category value, so filtering out
    // anything that stringifies to undefined would hide real rows.
    const withLiteralUndefined: QueryResultData = {
      columns,
      rows: [
        { weekday: 'undefined', period: 'Morning', count: 10 },
        { weekday: 'Monday', period: 'Morning', count: 34 },
      ],
    }
    const model = buildHeatmapModel({ columnMapping: { weekday: 'x', period: 'y', count: 'value' } }, withLiteralUndefined)
    expect(model?.xCategories).toEqual(['undefined', 'Monday'])
    expect(model?.cells.size).toBe(2)
    expect(Array.from(model?.cells.values() ?? []).sort((a, b) => a - b)).toEqual([10, 34])
  })
})
