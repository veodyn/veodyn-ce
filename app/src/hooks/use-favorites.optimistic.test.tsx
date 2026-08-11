// The star has to move on the click, not on the response.
//
// Every assertion here is made while the write is still in flight, because
// that is the whole defect: invalidating on success alone left the control
// unchanged for the length of the round trip and the refetch behind it, and a
// control that does not move reads as a dead one. What is pinned is what the
// CACHE holds at that moment, not which TanStack call was made, so an
// implementation that patches the wrong key fails rather than passes.
//
// USE_REAL_API is forced true: in mock mode the store answers synchronously,
// so there is no window in which an optimistic update is distinguishable from
// no update at all.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: toastError, info: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))
vi.mock('@/services/redash/favorites', () => ({ setFavorite: vi.fn() }))
vi.mock('@/services/favorites/client', () => ({
  fetchFavorites: vi.fn(),
  setFavorite: vi.fn(),
}))

import * as redashFavorites from '@/services/redash/favorites'
import * as veodynFavorites from '@/services/favorites/client'
import { FAVORITES_KEY, useToggleFavorite } from './use-favorites'

afterEach(() => {
  vi.clearAllMocks()
})

/** A write that never settles on its own, so "in flight" is a state we hold. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  // The rejection is attached in the test, not here; an unhandled one would
  // fail the run for the right reason at the wrong time.
  promise.catch(() => {})
  return { promise, resolve, reject }
}

function harness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  const { result } = renderHook(() => useToggleFavorite(), { wrapper: Wrapper })
  return { qc, result }
}

interface Row {
  id: number
  name: string
  is_favorite: boolean
}

function listOf(...rows: Row[]) {
  return { count: rows.length, results: rows }
}

describe('useToggleFavorite, before the server answers', () => {
  it('fills the star in every cached list at once, not just the one on screen', async () => {
    const pending = deferred<void>()
    vi.mocked(redashFavorites.setFavorite).mockReturnValue(pending.promise)
    const { qc, result } = harness()

    // The same query, cached under three of the keys the library uses: the
    // paged list, the whole-library read, and its own detail entry.
    qc.setQueryData(['queries', undefined, 1], listOf({ id: 7, name: 'Ridership', is_favorite: false }))
    qc.setQueryData(['queries', 'all', undefined, undefined, 1], listOf({ id: 7, name: 'Ridership', is_favorite: false }))
    qc.setQueryData(['query', 7], { id: 7, name: 'Ridership', is_favorite: false })

    act(() => {
      result.current.mutate({ type: 'queries', id: 7, favorite: true })
    })

    await waitFor(() => {
      expect(qc.getQueryData<ReturnType<typeof listOf>>(['queries', undefined, 1])?.results[0].is_favorite).toBe(true)
    })
    expect(
      qc.getQueryData<ReturnType<typeof listOf>>(['queries', 'all', undefined, undefined, 1])?.results[0].is_favorite
    ).toBe(true)
    expect(qc.getQueryData<Row>(['query', 7])?.is_favorite).toBe(true)
    // Still in flight: the star moved without the server having agreed.
    expect(vi.mocked(redashFavorites.setFavorite)).toHaveBeenCalledWith('queries', 7, true)

    pending.resolve()
  })

  it('leaves the other rows in the list alone', async () => {
    const pending = deferred<void>()
    vi.mocked(redashFavorites.setFavorite).mockReturnValue(pending.promise)
    const { qc, result } = harness()
    qc.setQueryData(
      ['queries', undefined, 1],
      listOf(
        { id: 7, name: 'Ridership', is_favorite: false },
        { id: 8, name: 'Air quality', is_favorite: true }
      )
    )

    act(() => {
      result.current.mutate({ type: 'queries', id: 7, favorite: true })
    })

    await waitFor(() => {
      const rows = qc.getQueryData<ReturnType<typeof listOf>>(['queries', undefined, 1])?.results
      expect(rows?.[0].is_favorite).toBe(true)
      expect(rows?.[1].is_favorite).toBe(true)
    })
    pending.resolve()
  })

  it('adds a KPI id to the sidecar list without waiting for the write', async () => {
    const pending = deferred<void>()
    vi.mocked(veodynFavorites.setFavorite).mockReturnValue(pending.promise)
    const { qc, result } = harness()
    qc.setQueryData(FAVORITES_KEY, { kpi: [], report: ['r-2'] })

    act(() => {
      result.current.mutate({ type: 'kpi', id: 'k-1', favorite: true })
    })

    await waitFor(() => {
      expect(qc.getQueryData<{ kpi: string[] }>(FAVORITES_KEY)?.kpi).toEqual(['k-1'])
    })
    // The other kind shares the key and must survive the patch.
    expect(qc.getQueryData<{ report: string[] }>(FAVORITES_KEY)?.report).toEqual(['r-2'])
    pending.resolve()
  })
})

describe('useToggleFavorite, when the write is refused', () => {
  it('puts the star back and says so, rather than leaving a lie on screen', async () => {
    vi.mocked(redashFavorites.setFavorite).mockRejectedValue(new Error('403'))
    const { qc, result } = harness()
    qc.setQueryData(['queries', undefined, 1], listOf({ id: 7, name: 'Ridership', is_favorite: true }))
    qc.setQueryData(['query', 7], { id: 7, name: 'Ridership', is_favorite: true })

    act(() => {
      result.current.mutate({ type: 'queries', id: 7, favorite: false })
    })

    await waitFor(() => {
      expect(toastError.mock.calls[0]?.[0]).toBe('Could not remove that from your favorites.')
    })
    expect(
      qc.getQueryData<ReturnType<typeof listOf>>(['queries', undefined, 1])?.results[0].is_favorite
    ).toBe(true)
    expect(qc.getQueryData<Row>(['query', 7])?.is_favorite).toBe(true)
  })

  it('restores the sidecar list too', async () => {
    vi.mocked(veodynFavorites.setFavorite).mockRejectedValue(new Error('500'))
    const { qc, result } = harness()
    qc.setQueryData(FAVORITES_KEY, { kpi: ['k-1'], report: [] })

    act(() => {
      result.current.mutate({ type: 'kpi', id: 'k-1', favorite: false })
    })

    await waitFor(() => {
      expect(toastError.mock.calls[0]?.[0]).toBe('Could not remove that from your favorites.')
    })
    expect(qc.getQueryData<{ kpi: string[] }>(FAVORITES_KEY)?.kpi).toEqual(['k-1'])
  })
})
