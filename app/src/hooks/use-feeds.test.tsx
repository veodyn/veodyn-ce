import { describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFeeds } from './use-feeds'
import { useMockDataStore } from '@/stores/mock-data-store'

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useFeeds (mock mode)', () => {
  it('returns the store feeds', async () => {
    const { result } = renderHook(() => useFeeds(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data).toEqual(useMockDataStore.getState().feeds)
  })
})
