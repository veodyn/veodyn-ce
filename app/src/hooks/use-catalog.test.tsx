import { describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useCatalog, useDataset, useDomainHub, useDomainHubs } from './use-catalog'
import { useMockDataStore } from '@/stores/mock-data-store'

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useCatalog (mock mode)', () => {
  it('returns the store datasets', async () => {
    const { result } = renderHook(() => useCatalog(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data).toEqual(useMockDataStore.getState().datasets)
  })

  it('useDataset finds one by id and returns null for a miss', async () => {
    const id = useMockDataStore.getState().datasets[0].id
    const { result } = renderHook(() => useDataset(id), { wrapper })
    await waitFor(() => expect(result.current.data).toBeTruthy())
    expect(result.current.data?.id).toBe(id)

    const { result: miss } = renderHook(() => useDataset('nope'), { wrapper })
    await waitFor(() => expect(miss.current.isSuccess).toBe(true))
    expect(miss.current.data).toBeNull()
  })

  it('useDomainHub returns the hub for a known key', async () => {
    const key = useMockDataStore.getState().domainHubs[0].key
    const { result } = renderHook(() => useDomainHub(key), { wrapper })
    await waitFor(() => expect(result.current.data).toBeTruthy())
    expect(result.current.data?.key).toBe(key)
  })

  it('useDomainHubs returns all the store domain hubs', async () => {
    const { result } = renderHook(() => useDomainHubs(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data).toEqual(useMockDataStore.getState().domainHubs)
  })
})
