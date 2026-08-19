import { describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCaptures } from './use-captures'
import { useMockDataStore } from '@/stores/mock-data-store'

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useCaptures (mock mode)', () => {
  it('returns the store captures', async () => {
    const { result } = renderHook(() => useCaptures(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data).toEqual(useMockDataStore.getState().captures)
  })
})
