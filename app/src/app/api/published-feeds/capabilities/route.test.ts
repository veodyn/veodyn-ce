// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function load() {
  vi.resetModules()
  return import('./route')
}

describe('the published-feeds capabilities proxy', () => {
  it('answers 503 when no sidecar is configured', async () => {
    vi.stubEnv('CATALOG_API_URL', '')
    vi.stubEnv('KPI_API_URL', '')
    vi.stubEnv('REPORTS_API_URL', '')
    const { GET } = await load()

    const res = await GET(new Request('http://localhost/api/published-feeds/capabilities'))

    expect(res.status).toBe(503)
  })

  it('forwards the caller credential to the /capabilities path, not to a slug lookup', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ entities: ['vehicle_positions'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await load()

    const res = await GET(
      new Request('http://localhost/api/published-feeds/capabilities', {
        headers: { cookie: 'session=ada' },
      })
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ entities: ['vehicle_positions'] })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://sidecar:8000/published-feeds/capabilities')
    expect((init as RequestInit & { headers: Record<string, string> }).headers.cookie).toBe('session=ada')
  })

  it('answers 502 when the sidecar is unreachable', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      })
    )
    const { GET } = await load()

    const res = await GET(new Request('http://localhost/api/published-feeds/capabilities'))

    expect(res.status).toBe(502)
  })
})
