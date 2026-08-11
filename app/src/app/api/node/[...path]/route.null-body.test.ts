// @vitest-environment node
//
// Null-body statuses (204, 205, 304) cannot be handed a body. The Response
// constructor throws "Invalid response status code 204" for `''` just as it
// does for real bytes, and `response.text()` on an empty upstream body returns
// exactly `''`.
//
// That matters here because the throw happens inside the proxy's try block, so
// the catch at the bottom relabels a SUCCESSFUL upstream call as
// "Failed to reach node backend" with status 502. The backend returns
// `make_response("", 204)` from both data_sources.py and destinations.py, so
// deleting a data source through this proxy succeeded on the backend while the
// UI reported an outage and never invalidated its list.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

async function loadRoute() {
  vi.stubEnv('REDASH_URL', 'https://redash.example')
  vi.resetModules()
  return import('./route')
}

function ctx(path: string[]) {
  return { params: Promise.resolve({ path }) }
}

function deleteRequest(cookie = 'session=s1; redash_api_key=k456') {
  return new NextRequest('http://localhost/api/node/data_sources/3', {
    method: 'DELETE',
    headers: { cookie },
  })
}

describe('a null-body status from Redash', () => {
  // Flask's make_response("", 204) still labels the empty body text/html, so
  // the proxy reads it with response.text() and gets ''.
  it('passes a 204 delete through instead of relabelling it a 502', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204, headers: { 'content-type': 'text/html; charset=utf-8' } }))
    vi.stubGlobal('fetch', fetchMock)

    const { DELETE } = await loadRoute()
    const res = await DELETE(deleteRequest(), ctx(['data_sources', '3']))

    expect(res.status).toBe(204)
    expect(res.body).toBeNull()
    // The bug's signature: a successful delete surfaced as a backend outage.
    expect(await res.text()).toBe('')
  })

  it('passes a 204 with no content-type at all', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const { DELETE } = await loadRoute()
    const res = await DELETE(deleteRequest(), ctx(['destinations', '2']))

    expect(res.status).toBe(204)
  })

  it('passes a 205 through', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 205 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    const res = await POST(
      new NextRequest('http://localhost/api/node/queries/8', {
        method: 'POST',
        headers: { cookie: 'session=s1; redash_api_key=k456' },
      }),
      ctx(['queries', '8'])
    )

    expect(res.status).toBe(205)
  })

  // A 304 carries no body but its headers are the whole point of the answer,
  // so an early return that skipped the header forwarding below would trade
  // one bug for another.
  it('passes a 304 through and keeps the headers that make it useful', async () => {
    const upstream = new Response(null, {
      status: 304,
      headers: {
        'content-type': 'application/json',
        'content-disposition': 'attachment; filename="Weather history.xlsx"',
      },
    })
    upstream.headers.append('set-cookie', 'session=rotated; Path=/; HttpOnly')
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(upstream)
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute()
    // No stored key, so the proxy uses cookie-session auth and forwards
    // Redash's Set-Cookie headers.
    const res = await GET(
      new NextRequest('http://localhost/api/node/queries/8', {
        headers: { cookie: 'session=s1' },
      }),
      ctx(['queries', '8'])
    )

    expect(res.status).toBe(304)
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="Weather history.xlsx"'
    )
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.getSetCookie()).toContain('session=rotated; Path=/; HttpOnly')
  })

  // A 200 with a genuinely empty body is NOT a null-body status and must keep
  // carrying its (empty) body rather than being special-cased alongside them.
  it('still carries an empty 200 body', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('', { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute()
    const res = await GET(
      new NextRequest('http://localhost/api/node/queries', {
        headers: { cookie: 'session=s1; redash_api_key=k456' },
      }),
      ctx(['queries'])
    )

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })
})
