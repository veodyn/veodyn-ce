// After a mint or revoke the dialog that held the token unmounts on close, so
// the owning query's cache entry is what a reopened dialog reads
// (visualization.api_key, attached by QueryResource.get for an admin or the
// owner). While these hooks left that entry alone, reopening presented a
// revoked URL as live and a fresh token as absent, and the second Create
// cleared the link's expiry on the idempotent share endpoint.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as vizService from '@/services/redash/visualizations'
import { mockQueries, type MockQuery } from '@/lib/mock-data'
import { useShareVisualization, useUnshareVisualization } from './use-visualizations'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

const QUERY_ID = 31
const VIZ_ID = 7

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, wrapper }
}

function seededQuery(apiKey?: string): MockQuery {
  const base = structuredClone(mockQueries[0])
  return {
    ...base,
    id: QUERY_ID,
    visualizations: [{ ...base.visualizations[0], id: VIZ_ID, api_key: apiKey }],
  }
}

afterEach(() => vi.restoreAllMocks())

describe('useShareVisualization', () => {
  it('settles the minted token onto the cached owning query and marks it stale', async () => {
    vi.spyOn(vizService, 'shareVisualization').mockResolvedValue({
      public_url: '',
      api_key: 'tok-new',
    })
    const { qc, wrapper } = setup()
    qc.setQueryData(['query', QUERY_ID], seededQuery())
    const invalidate = vi.spyOn(qc, 'invalidateQueries')

    const { result } = renderHook(() => useShareVisualization(), { wrapper })
    result.current.mutate({ vizId: VIZ_ID, queryId: QUERY_ID, expiresAt: null })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const cached = qc.getQueryData<MockQuery>(['query', QUERY_ID])
    expect(cached?.visualizations[0].api_key).toBe('tok-new')
    // Stale as well as patched, so the next read confirms against the backend.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['query', QUERY_ID] })
  })
})

describe('useUnshareVisualization', () => {
  it('clears the token from the cached owning query so reopening cannot offer a dead link', async () => {
    vi.spyOn(vizService, 'unshareVisualization').mockResolvedValue()
    const { qc, wrapper } = setup()
    qc.setQueryData(['query', QUERY_ID], seededQuery('tok-old'))

    const { result } = renderHook(() => useUnshareVisualization(), { wrapper })
    result.current.mutate({ vizId: VIZ_ID, queryId: QUERY_ID })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const cached = qc.getQueryData<MockQuery>(['query', QUERY_ID])
    expect(cached?.visualizations[0].api_key).toBeUndefined()
  })
})
