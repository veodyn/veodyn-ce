// The visualization tab strip reads only from `useQueryById`, keyed
// `['query', id]`. Invalidating `['queries']` alone is the LIST prefix and does
// not match that singular key, so a created, renamed or deleted visualization
// never reached the editor.
//
// First describe asserts the mechanism (the right cache entries went stale),
// second asserts the behaviour through the hook the page actually uses.
import { describe, expect, it, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import {
  useCreateVisualization,
  useDeleteVisualization,
  useUpdateVisualization,
} from '@/hooks/use-visualizations'
import { useQueryById } from '@/hooks/use-queries'
import { useMockDataStore } from '@/stores/mock-data-store'
import { mockQueries } from '@/lib/mock-data'

const QUERY_ID = 1

let readBackClient: QueryClient

function readBackWrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={readBackClient}>{children}</QueryClientProvider>
}

beforeEach(() => {
  readBackClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // The mutations write into the shared in-memory Zustand store, which has no
  // reset of its own, so an edit or delete would leak into later tests.
  useMockDataStore.setState({
    queries: mockQueries.map((q) => ({ ...q, visualizations: [...q.visualizations] })),
  })
})

function seed(): { qc: QueryClient; wrapper: ({ children }: { children: ReactNode }) => ReactNode } {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  // Both keys present and fresh, so an assertion that one was invalidated cannot
  // pass by way of the entry simply not being there.
  qc.setQueryData(['query', QUERY_ID], { id: QUERY_ID })
  qc.setQueryData(['queries', {}], { count: 0, results: [] })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, wrapper }
}

function invalidated(qc: QueryClient, key: unknown[]): boolean {
  return qc.getQueryState(key)?.isInvalidated === true
}

function firstVizId(): number {
  const query = useMockDataStore.getState().queries.find((q) => q.id === QUERY_ID)
  const vizId = query?.visualizations[0]?.id
  if (vizId == null) throw new Error(`mock query ${QUERY_ID} has no visualization to mutate`)
  return vizId
}

describe('visualization mutations (mock mode)', () => {
  it('useCreateVisualization invalidates the query that owns the visualization', async () => {
    const { qc, wrapper } = seed()
    const { result } = renderHook(() => useCreateVisualization(), { wrapper })

    await result.current.mutateAsync({ queryId: QUERY_ID, type: 'CHART', name: 'Fresh Chart' })

    expect(invalidated(qc, ['query', QUERY_ID])).toBe(true)
    expect(invalidated(qc, ['queries', {}])).toBe(true)
  })

  it('useUpdateVisualization invalidates the query that owns the visualization', async () => {
    const { qc, wrapper } = seed()
    const { result } = renderHook(() => useUpdateVisualization(), { wrapper })

    await result.current.mutateAsync({ queryId: QUERY_ID, vizId: firstVizId(), name: 'Renamed' })

    expect(invalidated(qc, ['query', QUERY_ID])).toBe(true)
    expect(invalidated(qc, ['queries', {}])).toBe(true)
  })

  it('useDeleteVisualization invalidates the query that owned the visualization', async () => {
    const { qc, wrapper } = seed()
    const { result } = renderHook(() => useDeleteVisualization(), { wrapper })

    await result.current.mutateAsync({ queryId: QUERY_ID, vizId: firstVizId() })

    expect(invalidated(qc, ['query', QUERY_ID])).toBe(true)
    expect(invalidated(qc, ['queries', {}])).toBe(true)
  })

  it('returns the created visualization, so the caller can select its tab', async () => {
    const { wrapper } = seed()
    const { result } = renderHook(() => useCreateVisualization(), { wrapper })

    const created = await result.current.mutateAsync({
      queryId: QUERY_ID,
      type: 'CHART',
      name: 'Fresh Chart',
    })

    expect(created).toMatchObject({ type: 'CHART', name: 'Fresh Chart' })
    expect(typeof created?.id).toBe('number')
  })
})

describe('a visualization mutation, read back through useQueryById (the hook the query detail page actually uses)', () => {
  it('a newly created visualization appears without a page reload', async () => {
    const queryId = useMockDataStore.getState().queries[0].id
    const before = useMockDataStore.getState().queries[0].visualizations.length

    const { result } = renderHook(
      () => ({ query: useQueryById(queryId), create: useCreateVisualization() }),
      { wrapper: readBackWrapper },
    )
    await waitFor(() => expect(result.current.query.data?.visualizations).toHaveLength(before))

    await result.current.create.mutateAsync({ queryId, type: 'HEATMAP', name: 'Heatmap', options: {} })

    await waitFor(() => expect(result.current.query.data?.visualizations).toHaveLength(before + 1))
    expect(result.current.query.data?.visualizations.at(-1)?.name).toBe('Heatmap')
  })

  it('an edited visualization\'s new name appears without a page reload', async () => {
    const queryId = useMockDataStore.getState().queries[0].id
    const vizId = useMockDataStore.getState().queries[0].visualizations[0].id

    const { result } = renderHook(
      () => ({ query: useQueryById(queryId), update: useUpdateVisualization() }),
      { wrapper: readBackWrapper },
    )
    await waitFor(() => expect(result.current.query.data).not.toBeNull())

    await result.current.update.mutateAsync({ queryId, vizId, name: 'Renamed visualization' })

    await waitFor(() => {
      const viz = result.current.query.data?.visualizations.find((v) => v.id === vizId)
      expect(viz?.name).toBe('Renamed visualization')
    })
  })

  it('a deleted visualization disappears without a page reload', async () => {
    const queryId = useMockDataStore.getState().queries[0].id
    const before = useMockDataStore.getState().queries[0].visualizations.length
    const vizId = useMockDataStore.getState().queries[0].visualizations[0].id

    const { result } = renderHook(
      () => ({ query: useQueryById(queryId), del: useDeleteVisualization() }),
      { wrapper: readBackWrapper },
    )
    await waitFor(() => expect(result.current.query.data?.visualizations).toHaveLength(before))

    await result.current.del.mutateAsync({ queryId, vizId })

    await waitFor(() => expect(result.current.query.data?.visualizations).toHaveLength(before - 1))
    expect(result.current.query.data?.visualizations.some((v) => v.id === vizId)).toBe(false)
  })
})
