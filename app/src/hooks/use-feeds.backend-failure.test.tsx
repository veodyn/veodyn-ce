// The half of the Feed Health defect that lives below the page: with a backend
// configured, a 404 from /api/feeds has to reach the caller as an error. It
// nearly did not. `withFixtureFallback` swaps in fixtures on a 503 ("not wired
// yet"), and a fourth status quietly joining that list would put mock feeds on
// a real instance, which is the same lie the page was telling in a different
// place. Real-API mode is forced here, so this file is separate from
// use-feeds.test.tsx, which covers mock mode.
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

import { useFeeds } from './use-feeds'

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useFeeds against a configured backend', () => {
  it('surfaces a 404 as an error rather than an empty list', async () => {
    server.use(http.get('/api/feeds', () => new HttpResponse(null, { status: 404 })))

    const { result } = renderHook(() => useFeeds(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    // Not [] and not the fixtures: either would render as a healthy instance
    // with nothing in it.
    expect(result.current.data).toBeUndefined()
  })

  it('still falls back to fixtures on the 503 that means "not wired yet"', async () => {
    server.use(http.get('/api/feeds', () => new HttpResponse(null, { status: 503 })))

    const { result } = renderHook(() => useFeeds(), { wrapper })

    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.isError).toBe(false)
    expect(result.current.data?.length).toBeGreaterThan(0)
  })
})
