import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function proxied(url: string, slug = 'vehicles') {
  vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ feedVersion: '2026-08-01', entities: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
  )
  vi.stubGlobal('fetch', fetchMock)
  vi.resetModules()
  const { GET } = await import('./route')
  const response = await GET(new Request(url), { params: Promise.resolve({ slug }) })
  return { response, called: String(fetchMock.mock.calls[0]?.[0] ?? ''), init: fetchMock.mock.calls[0]?.[1] }
}

describe('the entity picker proxy', () => {
  it('forwards the lookup parameters instead of dropping the query string', async () => {
    const { called } = await proxied('http://localhost/api/published-feeds/vehicles/entities?kind=route&q=elm&limit=5')

    expect(called).toBe('http://sidecar:8000/published-feeds/vehicles/entities?kind=route&q=elm&limit=5')
  })

  it('sends nothing the backend cannot tell from unset', async () => {
    const { called } = await proxied('http://localhost/api/published-feeds/vehicles/entities?kind=stop&q=')

    expect(called).toBe('http://sidecar:8000/published-feeds/vehicles/entities?kind=stop')
  })

  it('forwards no query string at all when the caller set none', async () => {
    const { called } = await proxied('http://localhost/api/published-feeds/vehicles/entities')

    expect(called).toBe('http://sidecar:8000/published-feeds/vehicles/entities')
  })

  it('drops a parameter that is not part of the lookup', async () => {
    const { called } = await proxied('http://localhost/api/published-feeds/vehicles/entities?kind=trip&orgSlug=other')

    expect(called).toBe('http://sidecar:8000/published-feeds/vehicles/entities?kind=trip')
  })

  it('encodes the slug into the upstream path', async () => {
    const { called } = await proxied('http://localhost/api/published-feeds/a%2Fb/entities?kind=route', 'a/b')

    expect(called).toBe('http://sidecar:8000/published-feeds/a%2Fb/entities?kind=route')
  })

  it('threads the caller abort signal so a closed picker cancels the lookup', async () => {
    const { init } = await proxied('http://localhost/api/published-feeds/vehicles/entities?kind=route')

    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('passes the listing back untouched', async () => {
    const { response } = await proxied('http://localhost/api/published-feeds/vehicles/entities?kind=route')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ feedVersion: '2026-08-01', entities: [] })
  })

  it('answers 503 when no sidecar is configured rather than an empty listing', async () => {
    vi.stubEnv('CATALOG_API_URL', '')
    vi.stubEnv('KPI_API_URL', '')
    vi.stubEnv('REPORTS_API_URL', '')
    vi.resetModules()
    const { GET } = await import('./route')

    const response = await GET(new Request('http://localhost/x?kind=route'), {
      params: Promise.resolve({ slug: 'vehicles' }),
    })

    expect(response.status).toBe(503)
    expect(await response.json()).not.toHaveProperty('entities')
  })
})
