// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function loadRoute(catalogUrl?: string) {
  if (catalogUrl) vi.stubEnv('CATALOG_API_URL', catalogUrl)
  vi.resetModules()
  return import('./route')
}

describe('GET /api/feeds', () => {
  it('503s when CATALOG_API_URL is unset', async () => {
    const { GET } = await loadRoute(undefined)
    const res = await GET(new Request('http://localhost/api/feeds'))
    expect(res.status).toBe(503)
  })

  it('forwards to the backend feeds endpoint with the caller cookie when configured', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify([{ id: 'apc-daily', status: 'fresh' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute('http://backend.test')
    const res = await GET(
      new Request('http://localhost/api/feeds', { headers: { cookie: 'session=abc' } })
    )

    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls[0][0]).toContain('http://backend.test/feeds')
    const [, options] = fetchMock.mock.calls[0]
    expect(new Headers(options?.headers).get('cookie')).toBe('session=abc')
  })

  it('returns 502 when the backend is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )
    const { GET } = await loadRoute('http://backend.test')
    const res = await GET(new Request('http://localhost/api/feeds'))
    expect(res.status).toBe(502)
  })
})
