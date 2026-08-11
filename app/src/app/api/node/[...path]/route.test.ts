// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function loadRoute(redashUrl: string) {
  vi.stubEnv('REDASH_URL', redashUrl)
  vi.resetModules()
  return import('./route')
}

function ctx(path: string[]) {
  return { params: Promise.resolve({ path }) }
}

describe('Redash proxy route', () => {
  it('returns 503 when REDASH_URL is unset', async () => {
    const { GET } = await loadRoute('')
    const req = new NextRequest('http://localhost/api/node/queries')
    const res = await GET(req, ctx(['queries']))
    expect(res.status).toBe(503)
  })

  it('returns 401 for a private path with no credentials', async () => {
    const { GET } = await loadRoute('https://redash.example')
    const req = new NextRequest('http://localhost/api/node/queries')
    const res = await GET(req, ctx(['queries']))
    expect(res.status).toBe(401)
  })

  it('forwards to the backend with the user api key and strips own cookie', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute('https://redash.example')
    const req = new NextRequest('http://localhost/api/node/queries', {
      headers: { cookie: 'session=s123; redash_api_key=k456' },
    })
    const res = await GET(req, ctx(['queries']))

    expect(res.status).toBe(200)
    const call = fetchMock.mock.calls[0]
    expect(call).toBeDefined()
    if (!call) throw new Error('Expected backend fetch to be called')
    const [calledUrl, calledOpts] = call
    expect(calledOpts).toBeDefined()
    if (!calledOpts) throw new Error('Expected backend fetch options')
    expect(calledUrl).toBe('https://redash.example/api/queries')
    expect((calledOpts.headers as Record<string, string>)['Authorization']).toBe('Key k456')
    // Own cookie must never leak to Redash.
    expect((calledOpts.headers as Record<string, string>)['Cookie'] ?? '').not.toContain(
      'redash_api_key'
    )
  })

  it('does not forward Set-Cookie when it authenticated with an API key', async () => {
    // Redash answers an API-key request as an anonymous Flask-Login user and
    // hands back a fresh empty session. Forwarding that overwrites the
    // browser's real login cookie and signs the user out on the next request.
    const fetchMock = vi.fn<typeof fetch>()
    const backend = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    backend.headers.append('set-cookie', 'session=anonymous-session; Path=/; HttpOnly')
    backend.headers.append('set-cookie', 'csrf_token=anon-csrf; Path=/')
    fetchMock.mockResolvedValue(backend)
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute('https://redash.example')
    const req = new NextRequest('http://localhost/api/node/queries', {
      headers: { cookie: 'session=real-session; redash_api_key=k456' },
    })
    const res = await GET(req, ctx(['queries']))

    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie()).toEqual([])
  })

  it('forwards Set-Cookie when it authenticated with the session cookie', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const backend = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    backend.headers.append('set-cookie', 'session=rotated-session; Path=/; HttpOnly')
    fetchMock.mockResolvedValue(backend)
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute('https://redash.example')
    // No redash_api_key cookie, so the proxy falls back to cookie-session auth.
    const req = new NextRequest('http://localhost/api/node/queries', {
      headers: { cookie: 'session=real-session' },
    })
    const res = await GET(req, ctx(['queries']))

    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie()).toContain('session=rotated-session; Path=/; HttpOnly')
  })

  it('allows a public path (session) through without credentials', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    )
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await loadRoute('https://redash.example')
    const req = new NextRequest('http://localhost/api/node/session')
    const res = await GET(req, ctx(['session']))
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([
    ['dashboards', 'public', 'dash-token'],
    ['visualizations', 'public', 'viz-token'],
  ])('lets an anonymous %s/%s/<token> read through', async (...path) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      )
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await loadRoute('https://redash.example')

    const res = await GET(
      new NextRequest(`http://localhost/api/node/${path.join('/')}`),
      ctx(path)
    )

    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`https://redash.example/api/${path.join('/')}`)
  })

  // The public prefix is the whole token path, not the collection. A bare
  // visualization read is still a private path and still needs credentials.
  it.each([
    ['visualizations', '9'],
    ['visualizations', 'public'],
    ['dashboards', '3'],
  ] as const)('still rejects %s/%s with no credentials', async (collection, rest) => {
    const path = [collection, rest]
    const { GET } = await loadRoute('https://redash.example')

    const res = await GET(
      new NextRequest(`http://localhost/api/node/${path.join('/')}`),
      ctx(path)
    )

    expect(res.status).toBe(401)
  })
})
