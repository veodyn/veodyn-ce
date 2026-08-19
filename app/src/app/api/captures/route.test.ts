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

describe('GET /api/captures', () => {
  it('503s when CATALOG_API_URL is unset', async () => {
    const { GET } = await loadRoute(undefined)
    const res = await GET(new Request('http://localhost/api/captures'))
    expect(res.status).toBe(503)
  })

  it('forwards to the backend captures endpoint with the caller cookie when configured', async () => {
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
      new Request('http://localhost/api/captures', { headers: { cookie: 'session=abc' } })
    )

    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls[0][0]).toContain('http://backend.test/captures')
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
    const res = await GET(new Request('http://localhost/api/captures'))
    expect(res.status).toBe(502)
  })
})

describe('PUT /api/captures', () => {
  it('forwards a captureId to the expectation segment for that capture', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const { PUT } = await loadRoute('http://backend.test')
    const res = await PUT(
      new Request('http://localhost/api/captures?captureId=q_rail_21', {
        method: 'PUT',
        body: JSON.stringify({ expectedIntervalSeconds: 300 }),
      })
    )

    expect(res.status).toBe(204)
    expect(fetchMock.mock.calls[0][0]).toBe('http://backend.test/captures/q_rail_21/expectation')
    const [, options] = fetchMock.mock.calls[0]
    expect(options?.method).toBe('PUT')
    expect(options?.body).toBe(JSON.stringify({ expectedIntervalSeconds: 300 }))
    expect(new Headers(options?.headers).get('content-type')).toBe('application/json')
  })

  it('forwards captureId and resource=alert to the alert segment for that capture', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const { PUT } = await loadRoute('http://backend.test')
    const res = await PUT(
      new Request('http://localhost/api/captures?captureId=q_rail_21&resource=alert', {
        method: 'PUT',
        body: JSON.stringify({ armed: true }),
      })
    )

    expect(res.status).toBe(204)
    expect(fetchMock.mock.calls[0][0]).toBe('http://backend.test/captures/q_rail_21/alert')
    const [, options] = fetchMock.mock.calls[0]
    expect(options?.body).toBe(JSON.stringify({ armed: true }))
    expect(new Headers(options?.headers).get('content-type')).toBe('application/json')
  })

  it('400s when no captureId is given, without calling the backend', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const { PUT } = await loadRoute('http://backend.test')
    const res = await PUT(
      new Request('http://localhost/api/captures', {
        method: 'PUT',
        body: JSON.stringify({ expectedIntervalSeconds: 300 }),
      })
    )

    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
