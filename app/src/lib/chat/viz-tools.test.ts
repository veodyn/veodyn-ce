import { describe, expect, it, vi } from 'vitest'
import type { RedashQuery } from '@/services/redash/types'
import type { ChatToolRequestOf } from './frames'
import type { RedashTransport } from './transport'
import {
  CANNOT_DELETE_TABLE,
  NO_STORED_RESULT_FOR_COLUMNS,
  noVisualization,
  noVisualizationType,
  resolveVizChange,
  runDescribeVizType,
} from './viz-tools'

const signal = new AbortController().signal
const STAMP = '2026-10-24T10:00:00.123Z'
const CHART_STAMP = '2026-10-24T10:01:00.456Z'

function visualization(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    type: 'CHART',
    name: 'Bars',
    description: '',
    options: { globalSeriesType: 'bar', columnMapping: { day: 'x', trips: 'y' } },
    created_at: STAMP,
    updated_at: CHART_STAMP,
    ...overrides,
  }
}

function raw(overrides: Record<string, unknown> = {}): RedashQuery {
  return {
    id: 5,
    name: 'Trips',
    query: 'select 1',
    data_source_id: 2,
    is_archived: false,
    updated_at: STAMP,
    latest_query_data_id: 90,
    can_edit: true,
    visualizations: [
      { id: 10, type: 'TABLE', name: 'Table', description: '', options: {}, created_at: STAMP, updated_at: STAMP },
      visualization(),
    ],
    ...overrides,
  } as unknown as RedashQuery
}

function transportFor(query: RedashQuery = raw(), columns: string[] | null = ['day', 'trips']) {
  const get = vi.fn(async (path: string) => {
    if (path === 'queries/5') return query
    if (path === 'query_results/90' && columns) {
      return { query_result: { data: { columns: columns.map((name) => ({ name, type: 'string' })), rows: [] } } }
    }
    throw new Error(`unexpected ${path}`)
  })
  return { get, post: vi.fn(), del: vi.fn() } as unknown as RedashTransport
}

function propose(type: string, options: Record<string, unknown>, name = 'New'): ChatToolRequestOf<'propose_visualization'> {
  return { callId: '1-1', tool: 'propose_visualization', args: { queryId: 5, type, name, options } }
}

function update(
  args: Partial<ChatToolRequestOf<'update_visualization'>['args']>
): ChatToolRequestOf<'update_visualization'> {
  return { callId: '1-2', tool: 'update_visualization', args: { queryId: 5, visualizationId: 11, ...args } }
}

function remove(visualizationId: number): ChatToolRequestOf<'delete_visualization'> {
  return { callId: '1-3', tool: 'delete_visualization', args: { queryId: 5, visualizationId } }
}

describe('runDescribeVizType', () => {
  it('describes a core type with its enum values', () => {
    const result = runDescribeVizType({ callId: '1', tool: 'describe_visualization_type', args: { type: 'CHART' } })
    expect(result).toMatchObject({ kind: 'visualization_type', ok: true, type: 'CHART' })
    const options = (result as unknown as { options: { key: string; enum?: string[] }[] }).options
    expect(options.find((one) => one.key === 'globalSeriesType')?.enum).toContain('bar')
  })

  it('refuses a type with no declaration', () => {
    const result = runDescribeVizType({ callId: '1', tool: 'describe_visualization_type', args: { type: 'NOPE' } })
    expect(result).toMatchObject({ kind: 'visualization_type', ok: false })
  })
})

describe('resolveVizChange: new', () => {
  it('builds next from the type defaults plus the options and reports no problems', async () => {
    const result = await resolveVizChange(
      propose('PIVOT', { rowField: 'day', colField: 'trips', valueField: 'trips' }),
      transportFor(),
      signal
    )
    expect(result).toEqual({
      kind: 'visualization_check',
      ok: true,
      mode: 'new',
      queryId: 5,
      next: {
        type: 'PIVOT',
        name: 'New',
        options: { aggregation: 'sum', rowField: 'day', colField: 'trips', valueField: 'trips' },
      },
      problems: [],
    })
  })

  it('drops options the declaration does not know', async () => {
    const result = await resolveVizChange(propose('COUNTER', { countRow: true, bogus: 1 }), transportFor(), signal)
    expect(result).toMatchObject({ ok: true, next: { options: { countRow: true, rowNumber: 1 } } })
    expect((result as { next: { options: object } }).next.options).not.toHaveProperty('bogus')
  })

  it('reports a column the result does not have', async () => {
    const result = await resolveVizChange(propose('CHART', { columnMapping: { nope: 'y' } }), transportFor(), signal)
    expect(result).toMatchObject({ ok: true, problems: ['columnMapping: no column named nope'] })
  })

  it('refuses to check a column option before the query has a stored result', async () => {
    const query = raw({ latest_query_data_id: null })
    const result = await resolveVizChange(
      propose('CHART', { columnMapping: { day: 'x' } }),
      transportFor(query, null),
      signal
    )
    expect(result).toEqual({ kind: 'visualization_check', ok: false, error: NO_STORED_RESULT_FOR_COLUMNS })
    expect(NO_STORED_RESULT_FOR_COLUMNS).toBe('Run the query first (run_saved_query) so its columns are known.')
  })

  it('accepts options with no column reference before the query has a stored result', async () => {
    const query = raw({ latest_query_data_id: null })
    const result = await resolveVizChange(propose('COUNTER', { countRow: true }), transportFor(query, null), signal)
    expect(result).toMatchObject({ ok: true, problems: [] })
  })

  it('adds the type validator problems when a result exists and a validator is given', async () => {
    const validate = vi.fn(() => ['needs a y column'])
    const result = await resolveVizChange(propose('CHART', { globalSeriesType: 'bar' }), transportFor(), signal, validate)
    expect(result).toMatchObject({ ok: true, problems: ['needs a y column'] })
    expect(validate).toHaveBeenCalledWith('CHART', expect.objectContaining({ globalSeriesType: 'bar' }), expect.anything())
  })

  it('does not call the validator without a result', async () => {
    const validate = vi.fn(() => ['x'])
    const query = raw({ latest_query_data_id: null })
    await resolveVizChange(propose('COUNTER', { countRow: true }), transportFor(query, null), signal, validate)
    expect(validate).not.toHaveBeenCalled()
  })

  it('accepts only presets for a type with no declaration', async () => {
    const registered = () => true
    const refused = await resolveVizChange(propose('PLUGIN_X', { a: 1 }), transportFor(), signal, undefined, registered)
    expect(refused).toMatchObject({ kind: 'visualization_check', ok: false })
    const accepted = await resolveVizChange(propose('PLUGIN_X', {}), transportFor(), signal, undefined, registered)
    expect(accepted).toMatchObject({ ok: true, next: { type: 'PLUGIN_X', options: {} } })
  })

  it('refuses when the user cannot edit the query', async () => {
    const result = await resolveVizChange(propose('COUNTER', {}), transportFor(raw({ can_edit: false })), signal)
    expect(result).toMatchObject({ kind: 'visualization_check', ok: false })
  })
})

describe('resolveVizChange: unknown types', () => {
  it('refuses a new visualization of a type that is neither core nor registered', async () => {
    const result = await resolveVizChange(propose('pie', {}), transportFor(), signal)
    expect(result).toEqual({ kind: 'visualization_check', ok: false, error: noVisualizationType('pie') })
    expect(noVisualizationType('pie')).toMatch(/^No visualization type "pie"\. A pie chart is type CHART with set globalSeriesType = pie\. Types: TABLE, CHART, /)
  })

  it('refuses a type change to an unknown type', async () => {
    const result = await resolveVizChange(update({ type: 'pie' }), transportFor(), signal)
    expect(result).toEqual({ kind: 'visualization_check', ok: false, error: noVisualizationType('pie') })
  })

  it('accepts a registered plugin type, and lists it among the valid types', async () => {
    const registered = (type: string) => type === 'PLUGIN_X'
    const result = await resolveVizChange(propose('PLUGIN_X', {}), transportFor(), signal, undefined, registered)
    expect(result).toMatchObject({ ok: true })
    const refused = await resolveVizChange(propose('nope', {}), transportFor(), signal, undefined, registered)
    expect(refused).toMatchObject({ ok: false })
  })
})

describe('resolveVizChange: edit', () => {
  it('applies set and unset to the stored options and returns the snapshot', async () => {
    const result = await resolveVizChange(
      update({ set: [{ path: 'series.stacking', value: 'stack' }], unset: ['columnMapping.trips'] }),
      transportFor(),
      signal
    )
    expect(result).toEqual({
      kind: 'visualization_check',
      ok: true,
      mode: 'edit',
      queryId: 5,
      visualizationId: 11,
      snapshot: {
        type: 'CHART',
        name: 'Bars',
        options: { globalSeriesType: 'bar', columnMapping: { day: 'x', trips: 'y' } },
        updatedAt: CHART_STAMP,
      },
      next: {
        type: 'CHART',
        name: 'Bars',
        options: { globalSeriesType: 'bar', columnMapping: { day: 'x' }, series: { stacking: 'stack' } },
      },
      problems: [],
    })
  })

  it('refuses a column mapping that names a column the result lacks', async () => {
    const result = await resolveVizChange(
      update({ set: [{ path: 'columnMapping.missing', value: 'y' }] }),
      transportFor(),
      signal
    )
    expect(result).toMatchObject({ ok: true, problems: ['columnMapping: no column named missing'] })
  })

  it('starts a type change from the new type defaults and drops the old type options', async () => {
    const result = await resolveVizChange(
      update({ type: 'PIVOT', set: [{ path: 'rowField', value: 'day' }] }),
      transportFor(),
      signal
    )
    expect(result).toMatchObject({
      ok: true,
      next: { type: 'PIVOT', name: 'Bars', options: { aggregation: 'sum', rowField: 'day' } },
    })
  })

  it('keeps stored keys the declaration does not know on a same-type edit', async () => {
    const query = raw({
      visualizations: [visualization({ options: { globalSeriesType: 'bar', legacyThing: { a: 1 } } })],
    })
    const result = await resolveVizChange(update({ name: 'Renamed' }), transportFor(query), signal)
    expect(result).toMatchObject({
      ok: true,
      next: { name: 'Renamed', options: { globalSeriesType: 'bar', legacyThing: { a: 1 } } },
    })
  })

  it('keeps stored fields outside the declaration when editing one nested value', async () => {
    const stored = { referenceLines: [{ value: 3, axis: 'x', color: '#f00', label: 'a' }] }
    const query = raw({ visualizations: [visualization({ options: stored })] })
    const result = await resolveVizChange(
      update({ set: [{ path: 'referenceLines.0.label', value: 'b' }] }),
      transportFor(query),
      signal
    )
    expect(result).toMatchObject({
      ok: true,
      next: { options: { referenceLines: [{ value: 3, axis: 'x', color: '#f00', label: 'b' }] } },
    })
  })

  it('drops an operation whose value fails the declaration and keeps the stored value', async () => {
    const result = await resolveVizChange(
      update({ set: [{ path: 'globalSeriesType', value: 'radar' }, { path: 'showDataLabels', value: true }] }),
      transportFor(),
      signal
    )
    expect(result).toMatchObject({ ok: true, next: { options: { globalSeriesType: 'bar', showDataLabels: true } } })
  })

  it('does not blame the edit for a column problem already in the stored options', async () => {
    const query = raw({ visualizations: [visualization({ options: { columnMapping: { old: 'x' } } })] })
    const result = await resolveVizChange(update({ name: 'Renamed' }), transportFor(query), signal)
    expect(result).toMatchObject({ ok: true, problems: [] })
  })

  it('refuses an edit that changes nothing', async () => {
    const result = await resolveVizChange(update({ name: 'Bars' }), transportFor(), signal)
    expect(result).toMatchObject({ kind: 'visualization_check', ok: false })
  })

  it('refuses a visualization that is not on the query', async () => {
    const result = await resolveVizChange(update({ visualizationId: 99, name: 'x' }), transportFor(), signal)
    expect(result).toEqual({ kind: 'visualization_check', ok: false, error: noVisualization(99, 5) })
    expect(noVisualization(99, 5)).toBe('No visualization 99 on query 5.')
  })

  it('refuses option operations on a type with no declaration', async () => {
    const query = raw({ visualizations: [visualization({ type: 'PLUGIN_X', options: { a: 1 } })] })
    const result = await resolveVizChange(update({ set: [{ path: 'a', value: 2 }] }), transportFor(query), signal)
    expect(result).toMatchObject({ ok: false })
  })
})

describe('resolveVizChange: delete', () => {
  it('returns the snapshot to delete', async () => {
    const result = await resolveVizChange(remove(11), transportFor(), signal)
    expect(result).toMatchObject({
      kind: 'visualization_check',
      ok: true,
      mode: 'delete',
      queryId: 5,
      visualizationId: 11,
      snapshot: { type: 'CHART', name: 'Bars', updatedAt: CHART_STAMP },
      problems: [],
    })
    expect(result).not.toHaveProperty('next')
  })

  it('refuses the table visualization', async () => {
    const result = await resolveVizChange(remove(10), transportFor(), signal)
    expect(result).toEqual({ kind: 'visualization_check', ok: false, error: CANNOT_DELETE_TABLE })
    expect(CANNOT_DELETE_TABLE).toBe('The table visualization cannot be deleted.')
  })

  it('refuses a visualization that is not on the query', async () => {
    const result = await resolveVizChange(remove(99), transportFor(), signal)
    expect(result).toMatchObject({ ok: false, error: 'No visualization 99 on query 5.' })
  })
})
