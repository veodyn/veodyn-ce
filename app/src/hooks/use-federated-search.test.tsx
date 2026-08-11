import { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFederatedSearch } from '@/hooks/use-federated-search'
import { useMockDataStore } from '@/stores/mock-data-store'
import * as federatedSearchModule from '@/services/search/federated-search'
import type { MockQuery } from '@/lib/mock-data'

// Partial mock: wrap the real federatedSearch in a vi.fn so this file can
// assert what it was called with (query, signal), while calls still pass
// through to the real implementation, so results stay genuine.
vi.mock('@/services/search/federated-search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/search/federated-search')>()
  return { ...actual, federatedSearch: vi.fn(actual.federatedSearch) }
})
const federatedSearchSpy = vi.mocked(federatedSearchModule.federatedSearch)

function makeQuery(id: number, name: string): MockQuery {
  return {
    id, name, description: '', query: 'select 1', data_source_id: 1,
    schedule: null, tags: [], is_archived: false, is_draft: false,
    is_favorite: false, is_safe: true, can_edit: true,
    user: { id: 1, name: 'A', email: 'a@example.com' },
    last_modified_by: { id: 1, name: 'A', email: 'a@example.com' },
    visualizations: [], latest_query_data_id: null, options: { parameters: [] },
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
    retrieved_at: '', runtime: 0, version: 1,
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/**
 * Empty EVERY collection the store holds, not a named four.
 *
 * Federated search assembles its sources from the registry, so which
 * collections can produce a match is a property of which features this build
 * installs: the named list used to say `kpis` and would have had to say
 * `reports` next, and neither exists in a build without that feature. Every
 * pack fixture is a match waiting to leak into these assertions, so the honest
 * clear is all of them.
 */
function emptyEveryCollection() {
  const patch: Record<string, unknown[]> = {}
  for (const [key, value] of Object.entries(useMockDataStore.getState())) {
    if (Array.isArray(value)) patch[key] = []
  }
  useMockDataStore.setState(patch as Partial<ReturnType<typeof useMockDataStore.getState>>)
}

beforeEach(emptyEveryCollection)

afterEach(() => {
  emptyEveryCollection()
  federatedSearchSpy.mockClear()
})

describe('useFederatedSearch', () => {
  it('stays idle for an empty query', () => {
    const { result } = renderHook(() => useFederatedSearch(''), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
    expect(federatedSearchSpy).not.toHaveBeenCalled()
  })

  it('stays idle for a blank (whitespace-only) query', () => {
    const { result } = renderHook(() => useFederatedSearch('   '), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
    expect(federatedSearchSpy).not.toHaveBeenCalled()
  })

  it('federates the mock store for a non-empty query', async () => {
    useMockDataStore.setState({ queries: [makeQuery(1, 'Bus ridership')] })
    const { result } = renderHook(() => useFederatedSearch('bus'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data?.map((i) => i.title)).toEqual(['Bus ridership'])
  })

  it('threads a TanStack AbortSignal into federatedSearch', async () => {
    useMockDataStore.setState({ queries: [makeQuery(1, 'Bus ridership')] })
    const { result } = renderHook(() => useFederatedSearch('bus'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(federatedSearchSpy).toHaveBeenCalledWith('bus', { signal: expect.any(AbortSignal) })
  })
})
