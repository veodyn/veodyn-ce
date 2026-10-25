import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runLibraryTool } from './library-tools'
import { runAdhocQuery, runSavedQuery } from './saved-query-run'
import type { RedashTransport } from './transport'

const DATA = { columns: [{ name: 'n', type: 'integer', friendly_name: 'n' }], rows: [{ n: 4 }] }
const QUERY = {
  id: 12,
  name: 'Trips',
  query: 'SELECT 1',
  data_source_id: 3,
  visualizations: [{ id: 31, type: 'TABLE', name: 'Table', options: {} }],
  latest_query_data_id: 99,
  options: { parameters: [] },
}

const ROUTES: Record<string, unknown> = {
  'GET data_sources': [{ id: 3, name: 'Warehouse', type: 'clickhouse', syntax: 'sql' }],
  'GET data_sources/3': { id: 3, name: 'Warehouse', type: 'clickhouse', syntax: 'sql' },
  'GET data_sources/3/schema': { schema: [{ name: 'trips', columns: ['trip_id'] }] },
  'GET queries': { count: 1, results: [QUERY] },
  'GET queries/12': QUERY,
  'GET dashboards': { count: 0, results: [] },
  'GET dashboards/4': { id: 4, name: 'Ops' },
  'GET queries/tags': [{ name: 'a', count: 1 }],
  'GET dashboards/tags': [{ name: 'b', count: 2 }],
  'GET query_results/99': { query_result: { id: 99, data: DATA, retrieved_at: 't' } },
  'POST queries/12/results': { query_result: { id: 5, data: DATA, retrieved_at: 't' } },
  'POST query_results': { query_result: { id: 6, data: DATA, retrieved_at: 't' } },
}

function spyTransport() {
  const seen: string[] = []
  const answer = async (verb: string, path: string) => {
    seen.push(`${verb} ${path}`)
    const body = ROUTES[`${verb} ${path}`]
    if (body === undefined) throw new Error(`unrouted ${verb} ${path}`)
    return body
  }
  const transport = {
    get: (path: string) => answer('GET', path),
    post: (path: string) => answer('POST', path),
    del: (path: string) => answer('DELETE', path),
  } as unknown as RedashTransport
  return { transport, seen }
}

const signal = () => new AbortController().signal
let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn(async () => {
    throw new Error('the browser must not be reached')
  })
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

describe('runLibraryTool uses only the transport', () => {
  it('lists data sources and describes one through the transport', async () => {
    const { transport, seen } = spyTransport()
    const listed = await runLibraryTool({ callId: 'c', tool: 'list_data_sources', args: {} }, transport, signal())
    expect(listed).toMatchObject({ ok: true, sources: [{ id: 3 }] })
    const described = await runLibraryTool(
      { callId: 'c', tool: 'describe_data_source', args: { dataSourceId: 3 } },
      transport,
      signal()
    )
    expect(described).toMatchObject({ ok: true, tables: [{ name: 'trips', columns: ['trip_id'] }] })
    expect(seen).toEqual(['GET data_sources', 'GET data_sources/3', 'GET data_sources/3/schema'])
  })

  it('browses the library and reads the tag vocabularies through the transport', async () => {
    const { transport, seen } = spyTransport()
    const result = await runLibraryTool(
      { callId: 'c', tool: 'search_library', args: { text: '', kinds: ['query', 'dashboard'], tags: [] } },
      transport,
      signal()
    )
    expect(result).toMatchObject({ ok: true })
    expect([...seen].sort()).toEqual(['GET dashboards', 'GET dashboards/tags', 'GET queries', 'GET queries/tags'])
  })

  it('shows a visualization, opens a dashboard and opens a query through the transport', async () => {
    const { transport, seen } = spyTransport()
    const shown = await runLibraryTool(
      { callId: 'c', tool: 'show_visualization', args: { queryId: 12, visualizationId: null } },
      transport,
      signal()
    )
    expect(shown).toMatchObject({ ok: true, rowCount: 1 })
    const dashboard = await runLibraryTool(
      { callId: 'c', tool: 'open_dashboard', args: { dashboardId: 4 } },
      transport,
      signal()
    )
    expect(dashboard).toMatchObject({ ok: true })
    const query = await runLibraryTool({ callId: 'c', tool: 'open_query', args: { queryId: 12 } }, transport, signal())
    expect(query).toMatchObject({ kind: 'query_detail' })
    expect(seen).toEqual(['GET queries/12', 'GET query_results/99', 'GET dashboards/4', 'GET queries/12'])
  })

  it('runs a saved query and ad hoc SQL through the transport', async () => {
    const { transport, seen } = spyTransport()
    const saved = await runSavedQuery({ queryId: 12, parameters: {}, visualizationId: null }, transport, signal())
    expect(saved).toMatchObject({ dataSourceId: 3, data: DATA })
    const adhoc = await runAdhocQuery({ dataSourceId: 3, sql: 'SELECT 1' }, transport, signal())
    expect(adhoc).toEqual({ data: DATA, dataSourceId: 3, visualization: null })
    expect(seen).toEqual(['GET queries/12', 'POST queries/12/results', 'POST query_results'])
  })

  it('never reaches the browser fetch', async () => {
    const { transport } = spyTransport()
    await runLibraryTool({ callId: 'c', tool: 'list_data_sources', args: {} }, transport, signal())
    await runSavedQuery({ queryId: 12, parameters: {}, visualizationId: null }, transport, signal())
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
