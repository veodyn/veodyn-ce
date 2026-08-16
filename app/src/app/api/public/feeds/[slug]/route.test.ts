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
  return new Request('http://localhost/api/public/feeds/vehicles-live', { headers })
}

// A varint field tag (0x08) followed by a byte above 0x7f (0xff). A .text()
// round trip mangles multi-byte UTF-8 sequences, and this byte is not valid
// UTF-8 on its own, so a corrupting round trip changes it and this assertion
// can actually fail.
const PROTOBUF_BYTES = new Uint8Array([0x08, 0xff, 0x01, 0x00])

describe('the public feed proxy', () => {
  it('answers 503 when no sidecar is configured', async () => {
    vi.stubEnv('CATALOG_API_URL', '')
    vi.stubEnv('KPI_API_URL', '')
    vi.stubEnv('REPORTS_API_URL', '')
    const { GET } = await load()

    const res = await GET(request(), { params: Promise.resolve({ slug: 'vehicles-live' }) })

    expect(res.status).toBe(503)
  })

  it('serves the raw bytes unchanged, with the protobuf content type', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(PROTOBUF_BYTES, {
          status: 200,
          headers: { 'content-type': 'application/x-protobuf' },
        })
      )
    )
    const { GET } = await load()

    const res = await GET(request(), { params: Promise.resolve({ slug: 'vehicles-live' }) })
    const body = new Uint8Array(await res.arrayBuffer())

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/x-protobuf')
    expect(Array.from(body)).toEqual(Array.from(PROTOBUF_BYTES))
  })

  it('forwards neither cookie nor authorization even when the request carries both', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(PROTOBUF_BYTES, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await load()

    await GET(
      request({ cookie: 'session=someone-elses-session', authorization: 'Key someone-elses-key' }),
      { params: Promise.resolve({ slug: 'vehicles-live' }) }
    )

    // Normalized through `Headers` rather than read as a plain object. A
    // regression to `headers: request.headers` would pass a Headers INSTANCE,
    // whose `.cookie` property is undefined even while `.get('cookie')`
    // returns the secret and fetch sends it, so the object form of this
    // assertion would go green on exactly the bug it exists to catch.
    const sent = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(sent.get('cookie')).toBeNull()
    expect(sent.get('authorization')).toBeNull()
  })

  it.each([404])(
    'answers a plain 404 for upstream %i without repeating its body',
    async (status) => {
      vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(JSON.stringify({ error: { id: 'PUBLIC_FEED_NOT_FOUND', message: "no public feed at 'x'" } }), {
            status,
            headers: { 'content-type': 'application/json' },
          })
        )
      )
      const { GET } = await load()

      const res = await GET(request(), { params: Promise.resolve({ slug: 'vehicles-live' }) })
      const body = await res.json()

      expect(res.status).toBe(404)
      expect(JSON.stringify(body)).not.toContain('PUBLIC_FEED_NOT_FOUND')
      expect(JSON.stringify(body)).not.toContain('no public feed at')
    }
  )

  it('passes a stale-feed 503 through with its Retry-After', async () => {
    // The one upstream refusal that is neither an absence nor a fault: a
    // `last_good` feed past its cap. Folding it into the 502 below would tell a
    // consumer the backend broke, and folding it into the 404 above would tell
    // them the feed was gone; both send them somewhere other than "poll again".
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { id: 'VEODYN_PUBLIC_FEED_TOO_STALE' } }), {
            status: 503,
            headers: { 'retry-after': '300' },
          })
      )
    )
    const { GET } = await load()

    const res = await GET(request(), { params: Promise.resolve({ slug: 'vehicles-live' }) })

    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('300')
    // Upstream's own body still does not come through, same as every other
    // refusal on this route.
    expect(JSON.stringify(await res.json())).not.toContain('VEODYN_PUBLIC_FEED_TOO_STALE')
  })

  it.each([
    ['an ingress HTML body', 'text/html', '<html>503 Service Unavailable</html>'],
    ['some other JSON refusal', 'application/json', JSON.stringify({ error: { id: 'SOMETHING_ELSE' } })],
  ])('folds a 503 that is not a stale feed (%s) into 502', async (_label, type, body) => {
    // A 503 is also what an ingress with no healthy backend answers, and what a
    // restarting pod answers. Reporting that as "stale, retry" would tell every
    // consumer to keep polling straight through an outage, which is the 404
    // collapse's mistake pointed the other way.
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 503, headers: { 'content-type': type } }))
    )
    const { GET } = await load()

    const res = await GET(request(), { params: Promise.resolve({ slug: 'vehicles-live' }) })

    expect(res.status).toBe(502)
    expect(res.headers.get('retry-after')).toBeNull()
  })

  it.each([500, 429])(
    'answers 502 for upstream %i, so an outage does not read as a missing feed',
    async (status) => {
      // The counterpart to the 404 case above. Both hide the upstream body, but
      // only a genuine "not available" may answer 404: a backend that is down
      // answers this way for every slug, so reporting it as 404 would tell a
      // consumer their feed was unpublished.
      vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
      vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream detail', { status })))
      const { GET } = await load()

      const res = await GET(request(), { params: Promise.resolve({ slug: 'vehicles-live' }) })

      expect(res.status).toBe(502)
      expect(JSON.stringify(await res.json())).not.toContain('upstream detail')
    }
  )

  it('answers 502 when the sidecar is unreachable', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      })
    )
    const { GET } = await load()

    const res = await GET(request(), { params: Promise.resolve({ slug: 'vehicles-live' }) })

    expect(res.status).toBe(502)
  })
})
