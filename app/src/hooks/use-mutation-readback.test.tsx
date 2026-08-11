// A mock-mode update mutation resolves with the object it just wrote.
//
// It used to resolve with the object as it was BEFORE the write. `useMockDataStore()`
// hands a component the state as of its last render, and these mutations then
// read the result back off that same snapshot. The store's write replaces the
// array, so the snapshot still points at the old one and the read finds the old
// row. A non-null assertion on the lookup hid the shape of the mistake: the
// value was never missing, it was simply stale.
//
// Nothing caught it because nothing asserted on what these mutations return, so
// the staleness only ever reached a caller that used the resolved value instead
// of waiting for the invalidated query to refetch.
// The bug class is shared by every update mutation in the tree, so the same
// case exists for the enterprise ones in use-alerts.readback.test.tsx, which
// ships with them. Split rather than dropped: the mistake was in a pattern, not in one
// hook, and the pattern is on both sides of the CE/EE line.
import { describe, expect, it, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { useUpdateQuery } from '@/hooks/use-queries'
import { useMockDataStore } from '@/stores/mock-data-store'

let qc: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

describe('an update mutation in mock mode', () => {
  it('resolves with the renamed query, not the one from before the write', async () => {
    const id = useMockDataStore.getState().queries[0].id
    const { result } = renderHook(() => useUpdateQuery(), { wrapper })

    const updated = await result.current.mutateAsync({ id, name: 'Renamed query' })

    expect(updated.name).toBe('Renamed query')
  })
})
