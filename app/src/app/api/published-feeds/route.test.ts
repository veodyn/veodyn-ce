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

describe('the published-feeds proxy', () => {
  it('answers 503 when no sidecar is configured', async () => {
    vi.stubEnv('CATALOG_API_URL', '')
    vi.stubEnv('KPI_API_URL', '')
    vi.stubEnv('REPORTS_API_URL', '')
    const { GET } = await load()

    const res = await GET(new Request('http://localhost/api/published-feeds'))

    expect(res.status).toBe(503)
  })

  it('forwards the caller credential and passes the upstream body through', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify([{ slug: 'vehicles' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await load()

    const res = await GET(
      new Request('http://localhost/api/published-feeds', { headers: { cookie: 'session=ada' } })
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ slug: 'vehicles' }])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://sidecar:8000/published-feeds')
    expect((init as RequestInit & { headers: Record<string, string> }).headers.cookie).toBe('session=ada')
  })

  it('preserves a refusal body so the form can put it on the right field', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { id: 'VEODYN_PUBLISHED_FEED_SLUG_TAKEN', message: 'taken' } }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        })
      )
    )
    const { POST } = await load()

    const res = await POST(
      new Request('http://localhost/api/published-feeds', { method: 'POST', body: '{}' })
    )

    expect(res.status).toBe(409)
    expect((await res.json()).error.id).toBe('VEODYN_PUBLISHED_FEED_SLUG_TAKEN')
  })

  it('answers 502 when the sidecar is unreachable', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const { GET } = await load()

    const res = await GET(new Request('http://localhost/api/published-feeds'))

    expect(res.status).toBe(502)
  })
})
