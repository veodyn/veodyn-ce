// Reading data sources from a real backend.
//
// The list serializer and the detail serializer do not answer with the same
// shape: Redash omits options and groups from the list. Everything downstream
// is typed as if they were always there, so the hook fills them in, and this
// file pins that filling-in. A list row arriving without `options` must become
// an empty object, not undefined that blows up in the form three screens later.
//
// The other subject is the difference between "no data sources configured" and
// "the request was refused", which the data source pages render as two
// different screens and a hook without an error state collapses into one.
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))
vi.mock('@/services/redash/data-sources', () => ({
  listDataSources: vi.fn(),
  getDataSource: vi.fn(),
  listTypes: vi.fn(),
  getSchema: vi.fn(),
  createDataSource: vi.fn(),
  updateDataSource: vi.fn(),
  deleteDataSource: vi.fn(),
  pauseDataSource: vi.fn(),
  resumeDataSource: vi.fn(),
  testConnection: vi.fn(),
}))

import * as service from '@/services/redash/data-sources'
import {
  useDataSource,
  useDataSourceSchema,
  useDataSourceTypes,
  useDataSources,
  useTestConnection,
} from './use-data-sources'

const SOURCE_ID = 3

/** Exactly what the LIST endpoint sends: no options, no groups, no syntax. */
const LIST_ROW = {
  id: SOURCE_ID,
  name: 'Transit warehouse',
  type: 'clickhouse',
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(service.listDataSources).mockResolvedValue([LIST_ROW])
  vi.mocked(service.getDataSource).mockResolvedValue(LIST_ROW)
  vi.mocked(service.listTypes).mockResolvedValue([])
  vi.mocked(service.getSchema).mockResolvedValue([])
})

describe('the shape a list row arrives in', () => {
  it('fills in the keys the list serializer leaves out', async () => {
    const { result } = renderHook(() => useDataSources(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.[0]).toEqual({
      id: SOURCE_ID,
      name: 'Transit warehouse',
      type: 'clickhouse',
      syntax: 'sql',
      paused: 0,
      pause_reason: null,
      options: {},
      groups: {},
      created_at: '',
      view_only: false,
    })
  })

  it('keeps the values the detail endpoint does send', async () => {
    vi.mocked(service.getDataSource).mockResolvedValue({
      ...LIST_ROW,
      syntax: 'json',
      paused: 1,
      pause_reason: 'Vehicle feed stalled',
      options: { dbname: 'transit' },
      groups: { 2: true },
      view_only: true,
    })
    const { result } = renderHook(() => useDataSource(SOURCE_ID), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toMatchObject({
      syntax: 'json',
      paused: 1,
      pause_reason: 'Vehicle feed stalled',
      options: { dbname: 'transit' },
      view_only: true,
    })
  })

  // A paused source with no reason recorded is normal; null is what the page
  // checks for, and undefined would render the reason paragraph empty.
  it('normalizes an absent pause reason to null rather than undefined', async () => {
    vi.mocked(service.getDataSource).mockResolvedValue({ ...LIST_ROW, paused: 1 })
    const { result } = renderHook(() => useDataSource(SOURCE_ID), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.pause_reason).toBeNull()
  })
})

describe('a data source read that does not come back', () => {
  // The bug this rejects: a refused list rendering the "add your first data
  // source" empty state, which sends someone to create a duplicate of a source
  // that already exists.
  it('surfaces a refused list as an error rather than as no data sources', async () => {
    vi.mocked(service.listDataSources).mockRejectedValue(new Error('502'))
    const { result } = renderHook(() => useDataSources(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it('reports an install with no data sources as an empty success', async () => {
    vi.mocked(service.listDataSources).mockResolvedValue([])
    const { result } = renderHook(() => useDataSources(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([])
    expect(result.current.isError).toBe(false)
  })

  // Deleted and refused are different screens on the detail page, so a 404 that
  // the service turned into null must not arrive as an error, and an error must
  // not arrive as null.
  it('answers null for a data source that is gone, and does not call it an error', async () => {
    vi.mocked(service.getDataSource).mockResolvedValue(null)
    const { result } = renderHook(() => useDataSource(SOURCE_ID), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
    expect(result.current.isError).toBe(false)
  })

  it('surfaces a refused detail read as an error', async () => {
    vi.mocked(service.getDataSource).mockRejectedValue(new Error('500'))
    const { result } = renderHook(() => useDataSource(SOURCE_ID), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it('surfaces a refused schema read as an error, not as a warehouse with no tables', async () => {
    vi.mocked(service.getSchema).mockRejectedValue(new Error('the schema job failed'))
    const { result } = renderHook(() => useDataSourceSchema(SOURCE_ID), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  // Redash's configuration_schema is the same JSON-Schema structure the mock
  // types declare, so it is handed to the form untouched.
  it('passes the backend type list through to the form as it stands', async () => {
    const types = [
      { type: 'clickhouse', name: 'ClickHouse', configuration_schema: { properties: {} } },
    ]
    vi.mocked(service.listTypes).mockResolvedValue(types)
    const { result } = renderHook(() => useDataSourceTypes(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(types)
  })

  it('surfaces a refused type list as an error, not as a form with no types', async () => {
    vi.mocked(service.listTypes).mockRejectedValue(new Error('403'))
    const { result } = renderHook(() => useDataSourceTypes(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })
})

describe('reading a schema', () => {
  it('does not ask for a schema before a data source is chosen', async () => {
    const { result } = renderHook(() => useDataSourceSchema(undefined), { wrapper })

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'))
    expect(result.current.status).toBe('pending')
    expect(vi.mocked(service.getSchema)).not.toHaveBeenCalled()
  })

  // Refresh is a different request (it makes Redash re-introspect) and has to
  // be a different cache entry, or pressing Refresh returns the cached schema
  // it was pressed to replace.
  it('caches a refreshed schema apart from the cached one', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(
      () => ({
        cached: useDataSourceSchema(SOURCE_ID),
        refreshed: useDataSourceSchema(SOURCE_ID, true),
      }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={qc}>{children}</QueryClientProvider>
        ),
      }
    )

    await waitFor(() => {
      expect(result.current.cached.isSuccess).toBe(true)
      expect(result.current.refreshed.isSuccess).toBe(true)
    })
    // The third argument is the query's own AbortSignal, threaded down so
    // unmounting cancels a poll that can otherwise run for 30s.
    expect(vi.mocked(service.getSchema).mock.calls).toEqual([
      [SOURCE_ID, false, expect.any(AbortSignal)],
      [SOURCE_ID, true, expect.any(AbortSignal)],
    ])
  })
})

describe('testing a connection', () => {
  // A source with no id has never been saved, so there is nothing on the server
  // to test. Calling the endpoint with undefined in the path is a 404 that
  // reads as "connection failed" for a connection that was never attempted.
  it('refuses to test a data source that has not been saved yet', async () => {
    const { result } = renderHook(() => useTestConnection(), { wrapper })

    const answer = await act(async () => result.current.mutateAsync(undefined))

    expect(answer).toEqual({ ok: false, message: 'Save the data source before testing.' })
    expect(vi.mocked(service.testConnection)).not.toHaveBeenCalled()
  })

  it('passes a saved data source through to the backend test', async () => {
    vi.mocked(service.testConnection).mockResolvedValue({ ok: false, message: 'auth failed' })
    const { result } = renderHook(() => useTestConnection(), { wrapper })

    const answer = await act(async () => result.current.mutateAsync(SOURCE_ID))

    expect(vi.mocked(service.testConnection)).toHaveBeenCalledWith(SOURCE_ID)
    expect(answer).toEqual({ ok: false, message: 'auth failed' })
  })
})
