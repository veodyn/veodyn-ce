// A backend that is down and an account with nothing starred produce the same
// data: no ids came back. They must not produce the same screen, or the page
// tells someone their favorites are gone when the truth is that it could not
// read them.
//
// Real-API mode is forced for the whole file with vi.mock, the pattern the
// other real-mode suites here use, because USE_REAL_API is a module constant.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import FavoritesPage from './page'
import { useVeodynFavorites } from '@/hooks/use-favorites'
import { useMockDataStore } from '@/stores/mock-data-store'
import type { FeatureDescriptor } from '@/features/types'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

// Two starrable kinds, declared here rather than taken from whatever this build
// installed. The fixture the fallback path serves is seeded one list per kind
// the registry names, so without an explicit registry the case below would be
// asserting the contents of a tree instead of the shape of a fallback.
vi.mock('@/features/generated-registry', async () => {
  const { Star } = await import('lucide-react')
  const FEATURES: Record<string, FeatureDescriptor> = {
    kpis: {
      id: 'kpis',
      nav: [{ label: 'KPIs', href: '/kpis', icon: Star, section: 'library' }],
      routes: [],
      searchType: { type: 'kpi', label: 'KPIs', noun: 'KPI', icon: Star },
      slots: { 'favorites.section': async () => ({ default: () => null }) },
    },
    reports: {
      id: 'reports',
      nav: [{ label: 'Reports', href: '/reports', icon: Star, section: 'library' }],
      routes: [],
      searchType: { type: 'report', label: 'Reports', noun: 'report', icon: Star },
      slots: { 'favorites.section': async () => ({ default: () => null }) },
    },
  }
  return { FEATURES }
})

afterEach(resetStores)

describe('the Favorites page when a read fails', () => {
  it('says so instead of reporting an empty shelf', async () => {
    server.use(
      http.get('/api/favorites', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/kpis', () => HttpResponse.json([])),
      http.get('/api/reports', () => HttpResponse.json([])),
      http.get('*/api/queries', () => HttpResponse.json({ results: [], count: 0, page: 1, page_size: 25 })),
      http.get('*/api/dashboards', () => HttpResponse.json({ results: [], count: 0, page: 1, page_size: 25 }))
    )

    renderWithProviders(<FavoritesPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be read/i)
    expect(screen.queryByText(/Nothing starred yet/)).not.toBeInTheDocument()
  })

  it('falls back to fixtures when the sidecar is simply not wired up', async () => {
    // 503 is this repo's "not configured" signal, and it is the one failure
    // that must NOT surface: a real Redash with no sidecar reads favorites from
    // the fixture store, like every other contributed surface. Asserted on the
    // hook rather than the page, which would also need the four unrelated
    // endpoints the page reads to be standing.
    //
    // The two kinds below are the stub registry's at the top of this file, so
    // what is pinned is that the fallback answers with a list per starrable
    // kind, present even when empty, and not which kinds a tree ships.
    server.use(
      http.get('/api/favorites', () =>
        HttpResponse.json({ error: 'KPI_API_URL not configured' }, { status: 503 })
      )
    )
    useMockDataStore.getState().toggleVeodynFavorite('kpi', 'on-time-performance')

    function wrapper({ children }: { children: ReactNode }) {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>
    }
    const { result } = renderHook(() => useVeodynFavorites(), { wrapper })

    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data).toEqual({ kpi: ['on-time-performance'], report: [] })
    expect(result.current.isError).toBe(false)
  })
})
