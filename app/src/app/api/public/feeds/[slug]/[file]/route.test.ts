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

function request(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/public/feeds/bikes-live/station_status.json', { headers })
}

const PARAMS = { params: Promise.resolve({ slug: 'bikes-live', file: 'station_status.json' }) }

const STATION_STATUS = JSON.stringify({ last_updated: 1, ttl: 0, version: '2.3', data: { stations: [] } })

describe('the public gbfs member-file proxy', () => {
  it('serves the member file as JSON, passing the upstream content type through', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(STATION_STATUS, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
      )
    )
    const { GET } = await load()

    const res = await GET(request(), PARAMS)

    expect(res.status).toBe(200)
    // Hardcoding protobuf here, as this proxy once did, hands every GBFS
    // consumer a body its parser refuses.
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.text()).toBe(STATION_STATUS)
  })

  it('never answers with a content type outside the two it can serve', async () => {
    // Echoing the upstream header made this same-origin route able to answer
    // text/html, which a top-level navigation RENDERS. /api/* carries no CSP
    // and nosniff does not stop that, so the type is chosen, not reflected.
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<script>alert(1)</script>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
      )
    )
    const { GET } = await load()

    const res = await GET(request(), PARAMS)

    expect(res.headers.get('content-type')).toBe('application/x-protobuf')
  })

  it('still recognizes JSON when the upstream sends a charset with it', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{}', {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' },
          })
      )
    )
    const { GET } = await load()

    const res = await GET(request(), PARAMS)

    expect(res.headers.get('content-type')).toBe('application/json')
  })

  it('asks the sidecar for the slug and the file, both encoded', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await load()

    await GET(request(), PARAMS)

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://sidecar:8000/public/feeds/bikes-live/station_status.json'
    )
  })

  it('forwards neither cookie nor authorization', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await load()

    await GET(request({ cookie: 'session=someone-elses', authorization: 'Key someone-elses' }), PARAMS)

    const sent = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(sent.get('cookie')).toBeNull()
    expect(sent.get('authorization')).toBeNull()
  })

  it('answers the same 404 body the discovery route does', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"id":"X"}}', { status: 404 })))
    const { GET } = await load()

    const res = await GET(request(), PARAMS)

    expect(res.status).toBe(404)
    // The upstream body is never passed through: a file outside the set, a
    // private feed and an unknown slug must be one answer.
    const { ErrorIds } = await import('@/lib/errorIds')
    expect(await res.json()).toEqual({
      error: 'feed not available',
      errorId: ErrorIds.API_NOT_FOUND,
    })
  })

  it('keeps a stale refusal as a 503 with its Retry-After', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { id: 'VEODYN_PUBLIC_FEED_TOO_STALE' } }), {
            status: 503,
            headers: { 'retry-after': '60' },
          })
      )
    )
    const { GET } = await load()

    const res = await GET(request(), PARAMS)

    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('60')
  })
})
