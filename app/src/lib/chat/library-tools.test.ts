import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/services/api-client'
import { NO_RESULTS_SCHEMA, NO_STORED_RESULT, NOT_AVAILABLE, UNSUPPORTED_SYNTAX } from './library-results'
import { runLibraryTool } from './library-tools'

const queries = vi.hoisted(() => ({ search: vi.fn(), get: vi.fn() }))
const dashboards = vi.hoisted(() => ({ search: vi.fn(), get: vi.fn() }))
const execution = vi.hoisted(() => ({ getResult: vi.fn() }))
const dataSources = vi.hoisted(() => ({ listDataSources: vi.fn(), getDataSource: vi.fn(), getSchema: vi.fn() }))

vi.mock('@/services/redash/queries', () => queries)
vi.mock('@/services/redash/dashboards', () => dashboards)
vi.mock('@/services/redash/execution', () => execution)
vi.mock('@/services/redash/data-sources', () => dataSources)

const DATA = { columns: [{ name: 'n', type: 'integer', friendly_name: 'n' }], rows: [{ n: 4 }] }

function savedQuery(overrides: Record<string, unknown> = {}) {
  return {
    id: 12,
    name: 'Trips',
    description: '',
    query: 'SELECT 1',
    data_source_id: 3,
    tags: [],
    is_archived: false,
    visualizations: [{ id: 31, type: 'CHART', name: 'Trips' }],
    latest_query_data_id: 99,
    options: { parameters: [] },
    updated_at: '',
    ...overrides,
  }
}

const signal = () => new AbortController().signal

function search(text: string, kinds: ('query' | 'dashboard')[], tags: string[] = []) {
  return runLibraryTool({ callId: 'c', tool: 'search_library', args: { text, kinds, tags } }, signal())
}

function show(queryId: number, visualizationId: number | null = null) {
  return runLibraryTool({ callId: 'c', tool: 'show_visualization', args: { queryId, visualizationId } }, signal())
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('runLibraryTool', () => {
  it('searches only the kinds asked for, passing tags through', async () => {
    queries.search.mockResolvedValue({ results: [savedQuery()], count: 1 })
    const result = await search('trips', ['query'], ['bikeshare'])
    expect(queries.search).toHaveBeenCalledWith('trips', expect.objectContaining({ tags: ['bikeshare'] }))
    expect(dashboards.search).not.toHaveBeenCalled()
    expect(result).toMatchObject({ kind: 'library', ok: true, items: [{ type: 'query', id: 12 }] })
  })

  it('searches without a tag filter when none is given', async () => {
    queries.search.mockResolvedValue({ results: [], count: 0 })
    dashboards.search.mockResolvedValue({ results: [], count: 0 })
    await search('trips', ['query', 'dashboard'])
    expect(queries.search.mock.calls[0][1].tags).toBeUndefined()
    expect(dashboards.search).toHaveBeenCalledTimes(1)
  })

  it('shows a saved chart from its stored result without running it', async () => {
    queries.get.mockResolvedValue(savedQuery())
    execution.getResult.mockResolvedValue({ data: DATA, retrieved_at: '2026-09-17T06:00:00Z' })
    const result = await show(12)
    expect(execution.getResult).toHaveBeenCalledWith(99, expect.any(AbortSignal))
    expect(result).toMatchObject({
      kind: 'saved_visualization',
      ok: true,
      rowCount: 1,
      visualization: { id: 31 },
      retrievedAt: '2026-09-17T06:00:00Z',
    })
  })

  it('reports a query with no stored result, a missing chart and an archived query', async () => {
    queries.get.mockResolvedValueOnce(savedQuery({ latest_query_data_id: null }))
    expect(await show(12)).toEqual({ kind: 'saved_visualization', ok: false, error: NO_STORED_RESULT })
    queries.get.mockResolvedValueOnce(savedQuery())
    expect(await show(12, 5)).toMatchObject({ ok: false, error: expect.stringContaining('no visualization 5') })
    queries.get.mockResolvedValueOnce(savedQuery({ is_archived: true }))
    expect(await show(12)).toMatchObject({ ok: false, error: NOT_AVAILABLE })
    queries.get.mockResolvedValueOnce(null)
    expect(await show(12)).toMatchObject({ ok: false, error: NOT_AVAILABLE })
    expect(execution.getResult).not.toHaveBeenCalled()
  })

  it('says a forbidden dashboard is not available and passes other failures on', async () => {
    dashboards.get.mockRejectedValueOnce(new ApiError(403, 'forbidden'))
    const open = () => runLibraryTool({ callId: 'c', tool: 'open_dashboard', args: { dashboardId: 4 } }, signal())
    expect(await open()).toEqual({ kind: 'dashboard', ok: false, error: NOT_AVAILABLE })
    dashboards.get.mockRejectedValueOnce(new Error('network down'))
    expect(await open()).toMatchObject({ kind: 'dashboard', ok: false, error: expect.stringContaining('network down') })
  })

  it('rethrows once the caller has aborted', async () => {
    const controller = new AbortController()
    queries.get.mockImplementation(async () => {
      controller.abort()
      throw new Error('aborted')
    })
    await expect(
      runLibraryTool({ callId: 'c', tool: 'show_visualization', args: { queryId: 1, visualizationId: null } }, controller.signal)
    ).rejects.toThrow('aborted')
  })

  it('lists the data sources the analyst can see', async () => {
    dataSources.listDataSources.mockResolvedValue([
      { id: 1, name: 'Warehouse', type: 'clickhouse', syntax: 'sql', view_only: false },
      { id: 7, name: 'MCA', type: 'metrocloudalliance', syntax: 'json' },
    ])
    const result = await runLibraryTool({ callId: 'c', tool: 'list_data_sources', args: {} }, signal())
    expect(result).toEqual({
      kind: 'data_sources',
      ok: true,
      sources: [
        { id: 1, name: 'Warehouse', type: 'clickhouse', syntax: 'sql', viewOnly: false },
        { id: 7, name: 'MCA', type: 'metrocloudalliance', syntax: 'json', viewOnly: false },
      ],
    })
  })

  it('describes a sql-syntax data source with its tables and columns', async () => {
    dataSources.getDataSource.mockResolvedValue({ id: 1, name: 'Warehouse', type: 'clickhouse', syntax: 'sql' })
    dataSources.getSchema.mockResolvedValue([{ name: 'trips', columns: [{ name: 'trip_id', type: 'string' }] }])
    const result = await runLibraryTool(
      { callId: 'c', tool: 'describe_data_source', args: { dataSourceId: 1 } },
      signal()
    )
    expect(result).toEqual({
      kind: 'data_source_schema',
      ok: true,
      dataSourceId: 1,
      syntax: 'sql',
      tables: [{ name: 'trips', columns: ['trip_id'] }],
    })
  })

  it('describes a json-syntax data source as resources, parsing param names out of doc_params prose', async () => {
    dataSources.getDataSource.mockResolvedValue({ id: 7, name: 'MCA', type: 'metrocloudalliance', syntax: 'json' })
    dataSources.getSchema.mockResolvedValue([
      {
        name: '1. predictions > params',
        columns: [{ name: 'stop_id (optional): string - predictions for one stop', type: '' }],
      },
      { name: '1. predictions > returns', columns: [{ name: 'route: string', type: '' }] },
      { name: '__ Query Examples __', columns: [{ name: '{"resource": "predictions"}', type: '' }] },
    ])
    const result = await runLibraryTool(
      { callId: 'c', tool: 'describe_data_source', args: { dataSourceId: 7 } },
      signal()
    )
    expect(result).toEqual({
      kind: 'data_source_schema',
      ok: true,
      dataSourceId: 7,
      syntax: 'json',
      resources: [
        { name: 'predictions', params: ['stop_id'], returns: ['route: string'], example: '{"resource": "predictions"}' },
      ],
    })
  })

  it('says a results-type source has no static schema, without calling getSchema', async () => {
    dataSources.getDataSource.mockResolvedValue({ id: 9, name: 'Query Results', type: 'results', syntax: 'sql' })
    const result = await runLibraryTool(
      { callId: 'c', tool: 'describe_data_source', args: { dataSourceId: 9 } },
      signal()
    )
    expect(result).toEqual({ kind: 'data_source_schema', ok: false, dataSourceId: 9, error: NO_RESULTS_SCHEMA })
    expect(dataSources.getSchema).not.toHaveBeenCalled()
  })

  it('refuses an unsupported syntax without calling getSchema', async () => {
    dataSources.getDataSource.mockResolvedValue({ id: 12, name: 'Sheet', type: 'google_spreadsheets', syntax: 'custom' })
    const result = await runLibraryTool(
      { callId: 'c', tool: 'describe_data_source', args: { dataSourceId: 12 } },
      signal()
    )
    expect(result).toEqual({ kind: 'data_source_schema', ok: false, dataSourceId: 12, error: UNSUPPORTED_SYNTAX })
    expect(dataSources.getSchema).not.toHaveBeenCalled()
  })

  it('says an unknown data source is not available, keeping the id', async () => {
    dataSources.getDataSource.mockResolvedValue(null)
    const result = await runLibraryTool(
      { callId: 'c', tool: 'describe_data_source', args: { dataSourceId: 99 } },
      signal()
    )
    expect(result).toEqual({ kind: 'data_source_schema', ok: false, dataSourceId: 99, error: NOT_AVAILABLE })
  })

  it('keeps the id in a describe_data_source failure after the browser call has started', async () => {
    dataSources.getDataSource.mockResolvedValue({ id: 1, name: 'Warehouse', type: 'clickhouse', syntax: 'sql' })
    dataSources.getSchema.mockRejectedValue(new Error('network down'))
    const result = await runLibraryTool(
      { callId: 'c', tool: 'describe_data_source', args: { dataSourceId: 1 } },
      signal()
    )
    expect(result).toMatchObject({ kind: 'data_source_schema', ok: false, dataSourceId: 1 })
    expect((result as { error?: string }).error).toContain('network down')
  })
})
