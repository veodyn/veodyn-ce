import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NOT_AVAILABLE } from './library-results'
import { mergedParameters, runSavedQuery as runWithTransport, savedRunResult } from './saved-query-run'
import type { SavedRunSpec } from './run-spec'
import type { RedashTransport } from './transport'

const queries = vi.hoisted(() => ({ get: vi.fn() }))
const execution = vi.hoisted(() => ({ executeSavedQuery: vi.fn() }))

vi.mock('./node-calls', () => ({
  getQuery: (_transport: unknown, id: number) => queries.get(id),
  executeSavedQuery: (_transport: unknown, id: number, opts: unknown) => execution.executeSavedQuery(id, opts),
}))

const DATA = { columns: [{ name: 'n', type: 'integer', friendly_name: 'n' }], rows: [{ n: 1 }] }
const SIGNAL = new AbortController().signal

function runSavedQuery(spec: SavedRunSpec, signal: AbortSignal) {
  return runWithTransport(spec, {} as RedashTransport, signal)
}

function savedQuery(overrides: Record<string, unknown> = {}) {
  return {
    id: 137,
    name: 'Live route',
    data_source_id: 15,
    is_archived: false,
    options: {
      parameters: [
        { name: 'route', type: 'query', value: 'R020', queryId: 136 },
        { name: 'limit', type: 'number', value: 5 },
        { name: 'blank', type: 'text', value: null },
      ],
    },
    visualizations: [
      { id: 1371, type: 'TABLE', name: 'Table', options: {} },
      { id: 1372, type: 'TRANSIT_LIVE_MAP', name: 'Map', options: { stops: true } },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  queries.get.mockResolvedValue(savedQuery())
  execution.executeSavedQuery.mockResolvedValue({ id: 9, data: DATA })
})

describe('mergedParameters', () => {
  it('defaults_merge_with_overrides', () => {
    const merged = mergedParameters(savedQuery() as never, { route: 'R720' })
    expect(merged).toEqual({ route: 'R720', limit: 5 })
  })

  it('an_empty_text_default_is_a_value_and_is_kept', () => {
    const query = savedQuery({ options: { parameters: [{ name: 'note', type: 'text', value: '' }] } })
    expect(mergedParameters(query as never, {})).toEqual({ note: '' })
  })

  it('an_override_the_query_does_not_declare_is_still_sent_for_node_to_judge', () => {
    expect(mergedParameters(savedQuery() as never, { extra: 'x' })).toEqual({ route: 'R020', limit: 5, extra: 'x' })
  })
})

describe('runSavedQuery', () => {
  const spec = (visualizationId: number | null) => ({
    kind: 'saved' as const,
    queryId: 137,
    parameters: { route: 'R720' },
    visualizationId,
  })

  it('execution_forces_max_age_zero', async () => {
    await runSavedQuery(spec(null), SIGNAL)
    expect(execution.executeSavedQuery).toHaveBeenCalledWith(
      137,
      expect.objectContaining({ maxAge: 0, parameters: { route: 'R720', limit: 5 }, signal: SIGNAL })
    )
  })

  it('a_dynamic_date_preset_is_resolved_before_node_sees_it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 23, 12, 0, 0))
    try {
      queries.get.mockResolvedValue(
        savedQuery({ options: { parameters: [{ name: 'day', type: 'date', value: 'd_now' }] } })
      )
      await runSavedQuery(spec(null), SIGNAL)
      const sent = execution.executeSavedQuery.mock.calls[0][1].parameters
      expect(sent.day).toBe('2026-10-23')
    } finally {
      vi.useRealTimers()
    }
  })

  it('draws_the_requested_visualization_with_its_own_options', async () => {
    const run = await runSavedQuery(spec(1372), SIGNAL)
    expect(run.visualization).toMatchObject({ id: 1372, type: 'TRANSIT_LIVE_MAP', options: { stops: true } })
    expect(run.data).toEqual(DATA)
    expect(run.dataSourceId).toBe(15)
  })

  it('draws_the_main_visualization_when_none_is_named', async () => {
    const run = await runSavedQuery(spec(null), SIGNAL)
    expect(run.visualization?.id).toBe(1372)
  })

  it('an_unknown_visualization_id_still_returns_the_data_with_no_drawing', async () => {
    const run = await runSavedQuery(spec(999), SIGNAL)
    expect(run.visualization).toBeNull()
    expect(run.data).toEqual(DATA)
  })

  it('refuses_an_archived_or_missing_query_without_executing', async () => {
    queries.get.mockResolvedValue(savedQuery({ is_archived: true }))
    await expect(runSavedQuery(spec(null), SIGNAL)).rejects.toThrow(NOT_AVAILABLE)
    queries.get.mockResolvedValue(null)
    await expect(runSavedQuery(spec(null), SIGNAL)).rejects.toThrow(NOT_AVAILABLE)
    expect(execution.executeSavedQuery).not.toHaveBeenCalled()
  })

  it('lets_a_node_refusal_through_for_the_caller_to_report', async () => {
    execution.executeSavedQuery.mockRejectedValue(new Error('Invalid parameter value'))
    await expect(runSavedQuery(spec(null), SIGNAL)).rejects.toThrow('Invalid parameter value')
  })
})

describe('savedRunResult', () => {
  it('carries_the_saved_query_id_beside_the_shaped_rows', () => {
    const result = savedRunResult({ data: DATA, dataSourceId: 15, visualization: null }, 137)
    expect(result).toMatchObject({ kind: 'query_result', ok: true, dataSourceId: 15, savedQueryId: 137, rowCount: 1 })
    expect(result).not.toHaveProperty('notice')
  })
})
