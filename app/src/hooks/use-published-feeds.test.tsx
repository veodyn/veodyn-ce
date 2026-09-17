import { describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMockDataStore } from '@/stores/mock-data-store'
import {
  useAttempts,
  usePublishNow,
  usePublishedFeed,
  usePublishedFeeds,
  useQueryResultColumns,
} from './use-published-feeds'

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('published feed hooks in mock mode', () => {
  it('lists the fixture feeds', async () => {
    const { result } = renderHook(() => usePublishedFeeds(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data?.[0].slug).toBe('vehicles-live')
  })

  it('lists a feed that reaches the store after the first read, as a contributed one does', async () => {
    const { result } = renderHook(() => usePublishedFeeds(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    const before = result.current.data?.length ?? 0

    useMockDataStore.setState((s) => ({
      publishedFeeds: [...s.publishedFeeds, { ...s.publishedFeeds[0], slug: 'arrives-late' }],
    }))

    await waitFor(() => expect(result.current.data?.length).toBe(before + 1))
    expect(result.current.data?.some((feed) => feed.slug === 'arrives-late')).toBe(true)
  })

  it('reads by slug a feed that reaches the store after the first read', async () => {
    const { result } = renderHook(() => usePublishedFeed('reaches-late'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()

    useMockDataStore.setState((s) => ({
      publishedFeeds: [...s.publishedFeeds, { ...s.publishedFeeds[0], slug: 'reaches-late' }],
    }))

    await waitFor(() => expect(result.current.data?.slug).toBe('reaches-late'))
  })

  it('reads a feed history newest first', async () => {
    const { result } = renderHook(() => useAttempts('vehicles-live'), { wrapper })
    await waitFor(() => expect(result.current.data?.length).toBe(2))
    expect(result.current.data?.[0].decision).toBe('published')
    expect(result.current.data?.[0].isCurrent).toBe(true)
  })

  it('an attempt supersedes whatever was serving', async () => {
    const { result } = renderHook(() => usePublishNow(), { wrapper })
    await result.current.mutateAsync('vehicles-live')

    const history = useMockDataStore.getState().publishAttempts['vehicles-live']
    expect(history.filter((a) => a.isCurrent)).toHaveLength(1)
    expect(history[0].attemptId).toBe(3)
  })
})

describe('useQueryResultColumns in mock mode', () => {
  it('resolves the result id and column names from the mock store', async () => {
    // Query 1 (Rail Network Daily Ridership) points at result 101, whose
    // columns are date/line/vehicle_count/avg_speed.
    const { result } = renderHook(() => useQueryResultColumns(1), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())

    expect(result.current.data).toEqual({
      resultId: 101,
      columns: ['date', 'line', 'vehicle_count', 'avg_speed'],
    })
  })

  it('answers no result id and no columns for a query that has never run', async () => {
    useMockDataStore.setState((s) => ({
      queries: s.queries.map((q) => (q.id === 1 ? { ...q, latest_query_data_id: null } : q)),
    }))
    const { result } = renderHook(() => useQueryResultColumns(1), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())

    expect(result.current.data).toEqual({ resultId: null, columns: [] })
  })

  it('is disabled with no query id, so no picked query renders no columns', () => {
    const { result } = renderHook(() => useQueryResultColumns(undefined), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
  })
})
