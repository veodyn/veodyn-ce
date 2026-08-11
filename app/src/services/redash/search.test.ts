import { describe, expect, it } from 'vitest'
import { http, HttpResponse, delay } from 'msw'
import { server } from '@/test/msw/server'
import * as queriesService from '@/services/redash/queries'
import * as dashboardsService from '@/services/redash/dashboards'

describe('redash entity search()', () => {
  it('sends q= and normalizes query results', async () => {
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
    const page = await queriesService.search('bus')
    expect(seenQ).toBe('bus')
    expect(page.results[0].name).toBe('Bus ridership')
    // normalizeQuery fills the omitted list fields with defaults
    expect(page.results[0].description).toBe('')
  })

  it('aborts an in-flight search() when the caller signal fires', async () => {
    server.use(
      http.get('/api/node/queries', async () => {
        await delay(100)
        return HttpResponse.json({ count: 0, page: 1, page_size: 25, results: [] })
      })
    )
    const controller = new AbortController()
    const promise = queriesService.search('bus', { signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toThrow()
  })

  it('sends q= and normalizes dashboard results', async () => {
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
    const page = await dashboardsService.search('bus')
    expect(seenQ).toBe('bus')
    expect(page.results[0].slug).toBe('bus-dashboard')
    // normalizeDashboard fills the omitted tags field with a default
    expect(page.results[0].tags).toEqual([])
  })
})
