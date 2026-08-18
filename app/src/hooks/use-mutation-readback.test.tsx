// A mock-mode update mutation resolves with the object it just wrote.
//
// `useMockDataStore()` hands a component the state as of its last render, and
// the store's write replaces the array, so a mutation reading the result back
// off that snapshot finds the pre-write row. The same case for the enterprise
// mutations is in use-alerts.readback.test.tsx.
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
