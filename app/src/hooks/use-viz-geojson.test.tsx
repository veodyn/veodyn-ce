import { describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { useVizGeoJson } from '@/hooks/use-viz-geojson'
import type { ReactNode } from 'react'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const collection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'A' }, geometry: { type: 'Polygon', coordinates: [] } },
  ],
}

describe('useVizGeoJson', () => {
  it('loads geometry for a mapType from the same-origin /geo path', async () => {
    server.use(http.get('/geo/world-countries.geojson', () => HttpResponse.json(collection)))
    const { result } = renderHook(() => useVizGeoJson('world-countries'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data?.features).toHaveLength(1)
  })

  it('does not fetch when disabled, gating the request behind the enabled flag', async () => {
    const { result } = renderHook(() => useVizGeoJson('world-countries', { enabled: false }), { wrapper })
    // No MSW handler is registered for this path on purpose: if the hook fired
    // anyway, onUnhandledRequest: 'error' (src/test/setup.ts config) would fail
    // this test on its own.
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
    expect(result.current.isFetching).toBe(false)
  })

  it('surfaces a UI_VIZ_GEOJSON_FAILED error on a non-ok response', async () => {
    server.use(http.get('/geo/missing.geojson', () => new HttpResponse(null, { status: 404 })))
    const { result } = renderHook(() => useVizGeoJson('missing'), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as { id?: string })?.id).toBe('E_UI_002')
  })

  it('rejects a mapType that would escape /geo/ without ever issuing a same-origin fetch', async () => {
    // No MSW handler is registered for any path here on purpose: the mapType
    // guard must throw before fetch() runs. If it fired anyway,
    // onUnhandledRequest: 'error' (src/test/setup.ts) would fail this test.
    const { result } = renderHook(() => useVizGeoJson('../api/export'), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as { id?: string })?.id).toBe('E_UI_002')
  })

  it('surfaces a UI_VIZ_GEOJSON_FAILED error when a 200 response body lacks a features array', async () => {
    server.use(http.get('/geo/malformed.geojson', () => HttpResponse.json({ type: 'FeatureCollection' })))
    const { result } = renderHook(() => useVizGeoJson('malformed'), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as { id?: string })?.id).toBe('E_UI_002')
  })
})
