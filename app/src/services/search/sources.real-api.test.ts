// Real-API-mode coverage for the live community search sources. USE_REAL_API
// is a module-level constant, so it is forced true for this whole file via
// vi.mock, matching the pattern used by the other USE_REAL_API=true tests
// in this repo (see src/components/dashboard/share-dashboard-dialog.test.tsx).
//
// The feature sources have their own real-mode suites beside their clients:
// services/kpi/search-source.real-api.test.ts and the report equivalent.
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse, delay } from 'msw'
import { server } from '@/test/msw/server'
import { SEARCH_SOURCES } from '@/services/search/sources'
import type { SearchSource, SearchSourceType } from '@/services/search/types'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

function getSource(type: SearchSourceType): SearchSource {
  const source = SEARCH_SOURCES.find((s) => s.type === type)
  if (!source) throw new Error(`no search source registered for type ${type}`)
  return source
}

describe('search sources (real API mode)', () => {
  it('queries source maps a real Redash query to a routable result', async () => {
    let seenQ: string | null = null
    server.use(
      http.get('/api/node/queries', ({ request }) => {
        seenQ = new URL(request.url).searchParams.get('q')
        return HttpResponse.json({
          count: 1,
          page: 1,
          page_size: 25,
          results: [
            {
              id: 7,
              name: 'Bus ridership',
              query: 'select 1',
              data_source_id: 1,
              user: { id: 1, name: 'A', email: 'a@example.com' },
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-02T00:00:00Z',
              version: 1,
            },
          ],
        })
      })
    )

    const results = await getSource('query').search('bus', {})

    expect(seenQ).toBe('bus')
    expect(results).toEqual([
      {
        id: 'query-7',
        type: 'query',
        title: 'Bus ridership',
        subtitle: undefined,
        href: '/queries/7',
        updatedAt: '2026-01-02T00:00:00Z',
      },
    ])
  })

  it('dashboards source maps a real Redash dashboard to a routable result', async () => {
    let seenQ: string | null = null
    server.use(
      http.get('/api/node/dashboards', ({ request }) => {
        seenQ = new URL(request.url).searchParams.get('q')
        return HttpResponse.json({
          count: 1,
          page: 1,
          page_size: 25,
          results: [
            {
              id: 3,
              name: 'Bus dashboard',
              slug: 'bus-dashboard',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-02T00:00:00Z',
              version: 1,
            },
          ],
        })
      })
    )

    const results = await getSource('dashboard').search('bus', {})

    expect(seenQ).toBe('bus')
    expect(results).toEqual([
      {
        id: 'dashboard-3',
        type: 'dashboard',
        title: 'Bus dashboard',
        href: '/dashboards/3',
        updatedAt: '2026-01-02T00:00:00Z',
      },
    ])
  })

  it('threads the caller signal into the queries request so an abort cancels it', async () => {
    server.use(
      http.get('/api/node/queries', async () => {
        await delay(100)
        return HttpResponse.json({ count: 0, page: 1, page_size: 25, results: [] })
      })
    )
    const controller = new AbortController()
    const promise = getSource('query').search('bus', { signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toThrow()
  })

  it('threads the caller signal into the dashboards request so an abort cancels it', async () => {
    server.use(
      http.get('/api/node/dashboards', async () => {
        await delay(100)
        return HttpResponse.json({ count: 0, page: 1, page_size: 25, results: [] })
      })
    )
    const controller = new AbortController()
    const promise = getSource('dashboard').search('bus', { signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toThrow()
  })

  it('catalog source maps a real catalog dataset to a routable result', async () => {
    let seenQ: string | null = null
    server.use(
      http.get('/api/catalog', ({ request }) => {
        seenQ = new URL(request.url).searchParams.get('q')
        return HttpResponse.json([
          {
            id: 'bus-ridership',
            name: 'Bus ridership',
            description: 'Daily boardings by route',
            domain: 'transit',
            schema: [],
            freshness: { lastUpdatedAt: '2026-01-02T00:00:00Z', status: 'fresh' },
            coverage: { start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' },
            rowCount: 100,
            sources: [],
            tags: [],
            sampleQueryId: null,
          },
        ])
      })
    )

    const results = await getSource('catalog').search('bus', {})

    expect(seenQ).toBe('bus')
    expect(results).toEqual([
      {
        id: 'catalog-bus-ridership',
        type: 'catalog',
        title: 'Bus ridership',
        subtitle: 'Daily boardings by route',
        href: '/data/dataset/bus-ridership',
        updatedAt: '2026-01-02T00:00:00Z',
      },
    ])
  })

  it('threads the caller signal into the catalog request so an abort cancels it', async () => {
    server.use(
      http.get('/api/catalog', async () => {
        await delay(100)
        return HttpResponse.json([])
      })
    )
    const controller = new AbortController()
    const promise = getSource('catalog').search('bus', { signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toThrow()
  })
})
