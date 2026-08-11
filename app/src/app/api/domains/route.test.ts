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

describe('GET /api/domains', () => {
  it('503s when CATALOG_API_URL is unset', async () => {
    const { GET } = await loadRoute(undefined)
    const res = await GET(new Request('http://localhost/api/domains'))
    expect(res.status).toBe(503)
  })

  it('forwards to the backend and returns its domain hubs when configured', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify([{ key: 'transit' }, { key: 'water' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute('http://backend.test')
    const res = await GET(new Request('http://localhost/api/domains'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ key: 'transit' }, { key: 'water' }])
    expect(fetchMock).toHaveBeenCalledWith(
      'http://backend.test/domains',
      expect.objectContaining({ signal: expect.anything() })
    )
  })

  it('returns 502 when the backend is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )

    const { GET } = await loadRoute('http://backend.test')
    const res = await GET(new Request('http://localhost/api/domains'))

    expect(res.status).toBe(502)
  })

  it('forwards the caller cookie and authorization headers to the upstream fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute('http://backend.test')
    await GET(
      new Request('http://localhost/api/domains', {
        headers: { cookie: 'session=abc123', authorization: 'Bearer secret' },
      })
    )

    const [, options] = fetchMock.mock.calls[0]
    const upstreamHeaders = new Headers(options?.headers)
    expect(upstreamHeaders.get('cookie')).toBe('session=abc123')
    expect(upstreamHeaders.get('authorization')).toBe('Bearer secret')
  })

  it('omits the cookie header from the upstream fetch when the caller sent none', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute('http://backend.test')
    await GET(new Request('http://localhost/api/domains'))

    const [, options] = fetchMock.mock.calls[0]
    const upstreamHeaders = new Headers(options?.headers)
    expect(upstreamHeaders.has('cookie')).toBe(false)
  })
})
