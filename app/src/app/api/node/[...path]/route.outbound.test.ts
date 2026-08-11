// @vitest-environment node
//
// What the catch-all proxy SENDS. Every Redash call the browser makes goes
// through here, and the failure this repo has already lived through was not
// visible in the returned status: the handler reached Redash unauthenticated
// while the response still looked fine. So these assert the outbound URL, the
// method, and which credential (if any) was attached.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

async function loadRoute(redashUrl = 'https://redash.example') {
  vi.stubEnv('REDASH_URL', redashUrl)
  vi.resetModules()
  return import('./route')
}

function ctx(path: string[]) {
  return { params: Promise.resolve({ path }) }
}

function okJson() {
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
}

function stubFetch() {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okJson())
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

type FetchMock = ReturnType<typeof stubFetch>

function sentUrl(mock: FetchMock, index = 0): string {
  const call = mock.mock.calls[index]
  if (!call) throw new Error(`Expected an outbound fetch at index ${index}`)
  return String(call[0])
}

function sentHeaders(mock: FetchMock, index = 0): Record<string, string> {
  const call = mock.mock.calls[index]
  if (!call) throw new Error(`Expected an outbound fetch at index ${index}`)
  const raw = (call[1]?.headers ?? {}) as Record<string, string>
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]))
}

describe('proxy URL construction', () => {
  it('sends /ping to the Redash root, outside the /api namespace', async () => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute()

    const res = await GET(new NextRequest('http://localhost/api/node/ping'), ctx(['ping']))

    expect(res.status).toBe(200)
    // /api/ping does not exist in Redash; the csrf refresh would 404.
    expect(sentUrl(fetchMock)).toBe('https://redash.example/ping')
  })

  it('joins a nested path under /api and does not touch a segment named ping', async () => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute()
    const path = ['queries', '8', 'ping']

    await GET(
      new NextRequest('http://localhost/api/node/queries/8/ping', {
        headers: { cookie: 'session=s1' },
      }),
      ctx(path)
    )

    expect(sentUrl(fetchMock)).toBe('https://redash.example/api/queries/8/ping')
  })

  it('forwards the query string', async () => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute()

    await GET(
      new NextRequest('http://localhost/api/node/queries?page=2&page_size=25&q=weather', {
        headers: { cookie: 'session=s1' },
      }),
      ctx(['queries'])
    )

    const url = new URL(sentUrl(fetchMock))
    expect(url.pathname).toBe('/api/queries')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('page_size')).toBe('25')
    expect(url.searchParams.get('q')).toBe('weather')
  })

  // Was a DEFECT: the forwarding loop called `url.searchParams.set`, which
  // replaces rather than appends, so a repeated param collapsed to its LAST
  // value. services/api-client.ts:43 deliberately appends repeated params
  // ("?tags=a&tags=b (Redash list filtering)"), so filtering a query or
  // dashboard list by two tags silently filtered by one, and nothing surfaced:
  // the response was a valid, wrong, narrower page. Fixed by appending.
  it('forwards a repeated query param without dropping values', async () => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute()

    await GET(
      new NextRequest('http://localhost/api/node/queries?tags=alpha&tags=beta', {
        headers: { cookie: 'session=s1' },
      }),
      ctx(['queries'])
    )

    expect(new URL(sentUrl(fetchMock)).searchParams.getAll('tags')).toEqual(['alpha', 'beta'])
  })
})

describe('proxy credential selection', () => {
  it('passes a client-supplied Authorization header through verbatim', async () => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute()

    // The embed flow: a share key, no session cookie at all.
    const res = await GET(
      new NextRequest('http://localhost/api/node/queries/8/results', {
        headers: { authorization: 'Key embed-token-xyz' },
      }),
      ctx(['queries', '8', 'results'])
    )

    expect(res.status).toBe(200)
    expect(sentHeaders(fetchMock)['authorization']).toBe('Key embed-token-xyz')
    // Key auth is CSRF-exempt only while no session cookie rides along.
    expect(sentHeaders(fetchMock)['cookie']).toBeUndefined()
  })

  it('prefers the client Authorization header over the stored key cookie', async () => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute()

    await GET(
      new NextRequest('http://localhost/api/node/queries', {
        headers: {
          authorization: 'Key embed-token-xyz',
          cookie: 'session=s1; redash_api_key=stored-key',
        },
      }),
      ctx(['queries'])
    )

    expect(sentHeaders(fetchMock)['authorization']).toBe('Key embed-token-xyz')
  })

  it('forwards the session cookie and CSRF token when there is no key', async () => {
    const fetchMock = stubFetch()
    const { POST } = await loadRoute()

    await POST(
      new NextRequest('http://localhost/api/node/queries', {
        method: 'POST',
        headers: {
          cookie: 'session=s1; csrf_token=c1',
          'x-csrf-token': 'c1',
          'content-type': 'application/json',
        },
        body: '{"name":"New"}',
      }),
      ctx(['queries'])
    )

    const headers = sentHeaders(fetchMock)
    expect(headers['cookie']).toBe('session=s1; csrf_token=c1')
    // Without this header Redash rejects the cookie-session mutation.
    expect(headers['x-csrf-token']).toBe('c1')
    expect(headers['authorization']).toBeUndefined()
  })

  it('never lets the redash_api_key cookie reach Redash as a cookie', async () => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute()

    // Public path, so the key is NOT used as Authorization and the cookie
    // fallback runs: the strip is the only thing keeping it out.
    await GET(
      new NextRequest('http://localhost/api/node/session', {
        headers: { cookie: 'session=s1; redash_api_key=secret-key; csrf_token=c1' },
      }),
      ctx(['session'])
    )

    const headers = sentHeaders(fetchMock)
    expect(headers['cookie']).toBe('session=s1; csrf_token=c1')
    expect(headers['authorization']).toBeUndefined()
  })

  it('does not spend the stored key on a public path', async () => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute()

    await GET(
      new NextRequest('http://localhost/api/node/ping', {
        headers: { cookie: 'redash_api_key=secret-key' },
      }),
      ctx(['ping'])
    )

    expect(sentHeaders(fetchMock)['authorization']).toBeUndefined()
  })

  it.each([
    ['invite', 'invite-token'],
    ['reset', 'reset-token'],
  ])('lets an anonymous %s/<token> through', async (...path) => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute()

    const res = await GET(
      new NextRequest(`http://localhost/api/node/${path.join('/')}`),
      ctx(path)
    )

    expect(res.status).toBe(200)
    expect(sentUrl(fetchMock)).toBe(`https://redash.example/api/${path.join('/')}`)
  })

  it('rejects a three-segment invite path with no credentials', async () => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute()

    // The exemption is exactly two segments; anything deeper is a normal API.
    const res = await GET(
      new NextRequest('http://localhost/api/node/invite/a/b'),
      ctx(['invite', 'a', 'b'])
    )

    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not call Redash at all when REDASH_URL is unset', async () => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute('')

    const res = await GET(
      new NextRequest('http://localhost/api/node/queries', {
        headers: { cookie: 'session=s1' },
      }),
      ctx(['queries'])
    )

    expect(res.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
