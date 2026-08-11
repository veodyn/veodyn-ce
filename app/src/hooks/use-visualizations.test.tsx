// Two layers of cover for one fix, written independently on two branches and
// kept both ways round on merge.
//
// A visualization is not a top-level resource in this app: it is reached
// through the query that owns it, and the only place its tab strip reads from
// is `useQueryById`, keyed `['query', id]`. These three mutations invalidated
// `['queries']` alone, which is the LIST prefix and does not match the singular
// key, so the query editor kept serving the visualizations it had already
// fetched. Against the real backend that made Save look like it did nothing:
// the POST landed, the tab never appeared. In mock mode a reload would show the
// new tab but would also throw the change away, so adding, editing or deleting
// a visualization silently did nothing until a developer stumbled onto one.
//
// The first describe asserts the MECHANISM (the right cache entries went
// stale), the second asserts the BEHAVIOUR (the change is readable through the
// hook the page actually uses) without naming a cache key at all. The second
// is what a user would notice; the first says why when it breaks. Task 5's
// Playwright spec is what originally went looking for a Heatmap tab that was
// never there, and jsdom could have caught it all along: this is cache wiring,
// not layout, and nothing exercised the round trip before now.
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
  // Every mutation below writes straight into the shared, in-memory Zustand
  // store with no reset of its own: without restoring it here, the "edit" tests
  // permanently rename a query's first visualization and the "delete" tests
  // permanently remove one, corrupting whatever test happens to run after them
  // in the same process.
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
