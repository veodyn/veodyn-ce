// @vitest-environment node
//
// The four mutating verbs and the way upstream failures come back. Each verb
// is its own export, so a missing body forward or a swapped method only shows
// up on the verb that has it. The response side matters too: a proxy that
// flattens every upstream status into 200 hides Redash's own permission
// answers from the client.
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

function stubFetch(response: Response = new Response('{}', {
  status: 200,
  headers: { 'content-type': 'application/json' },
})) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

type FetchMock = ReturnType<typeof stubFetch>

function sentOptions(mock: FetchMock): RequestInit {
  const call = mock.mock.calls[0]
  if (!call) throw new Error('Expected an outbound fetch')
  if (!call[1]) throw new Error('Expected outbound fetch options')
  return call[1]
}

function mutationRequest(method: string, body?: string) {
  return new NextRequest('http://localhost/api/node/queries/8', {
    method,
    headers: {
      cookie: 'session=s1',
      'content-type': 'application/json',
      'x-csrf-token': 'c1',
    },
    body,
  })
}

describe('mutating verbs', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    'forwards %s with its method, body and target',
    async (method) => {
      const fetchMock = stubFetch()
      const route = await loadRoute()
      const handler = route[method]
      const payload = JSON.stringify({ name: `via ${method}` })

      const res = await handler(mutationRequest(method, payload), ctx(['queries', '8']))

      expect(res.status).toBe(200)
      const opts = sentOptions(fetchMock)
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://redash.example/api/queries/8')
      expect(opts.method).toBe(method)
      expect(opts.body).toBe(payload)
      // A followed 302 would swallow Redash's login redirect.
      expect(opts.redirect).toBe('manual')
      expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    }
  )

  it('sends no body when the request has none', async () => {
    const fetchMock = stubFetch()
    const { DELETE } = await loadRoute()

    await DELETE(mutationRequest('DELETE'), ctx(['queries', '8']))

    expect(sentOptions(fetchMock).body).toBeUndefined()
  })

  it('never reads a body on GET', async () => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute()

    await GET(
      new NextRequest('http://localhost/api/node/queries', { headers: { cookie: 'session=s1' } }),
      ctx(['queries'])
    )

    expect(sentOptions(fetchMock).body).toBeUndefined()
    expect(sentOptions(fetchMock).method).toBe('GET')
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    'rejects an unauthenticated %s before it reaches Redash',
    async (method) => {
      const fetchMock = stubFetch()
      const route = await loadRoute()
      const handler = route[method]

      const res = await handler(
        new NextRequest('http://localhost/api/node/queries/8', { method, body: '{}' }),
        ctx(['queries', '8'])
      )

      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ message: 'Please login to continue.' })
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )
})

// The URL the API-key dialog hands out: a results path with ?api_key=. The
// key is the whole credential (Redash validates it), so the gate must let it
// through with no session, and must not widen beyond the results paths.
describe('per-query api_key access', () => {
  it('forwards an unauthenticated results GET that carries api_key', async () => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute()

    const res = await GET(
      new NextRequest('http://localhost/api/node/queries/7/results.json?api_key=k1'),
      ctx(['queries', '7', 'results.json'])
    )

    expect(res.status).toBe(200)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://redash.example/api/queries/7/results.json?api_key=k1'
    )
  })

  it('still rejects an unauthenticated non-results path carrying api_key', async () => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute()

    const res = await GET(
      new NextRequest('http://localhost/api/node/queries/7?api_key=k1'),
      ctx(['queries', '7'])
    )

    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not forward the anonymous session Redash mints for a key request', async () => {
    stubFetch(
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'set-cookie': 'session=anon; Path=/' },
      })
    )
    const { GET } = await loadRoute()

    const res = await GET(
      new NextRequest('http://localhost/api/node/queries/7/results.json?api_key=k1'),
      ctx(['queries', '7', 'results.json'])
    )

    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie()).toEqual([])
  })
})

describe('upstream failures', () => {
  it.each([400, 403, 404, 422, 500])('passes an upstream %i straight through', async (status) => {
    stubFetch(
      new Response(JSON.stringify({ message: 'upstream said so' }), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    )
    const { GET } = await loadRoute()

    const res = await GET(
      new NextRequest('http://localhost/api/node/queries/8', {
        headers: { cookie: 'session=s1' },
      }),
      ctx(['queries', '8'])
    )

    expect(res.status).toBe(status)
    // The client's error handling reads the upstream message, so the body has
    // to survive as well as the status.
    expect(await res.json()).toEqual({ message: 'upstream said so' })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('passes a 302 back rather than following it', async () => {
    stubFetch(
      new Response(null, { status: 302, headers: { location: 'https://redash.example/login' } })
    )
    const { GET } = await loadRoute()

    const res = await GET(
      new NextRequest('http://localhost/api/node/queries', {
        headers: { cookie: 'session=s1' },
      }),
      ctx(['queries'])
    )

    expect(res.status).toBe(302)
  })

  it('answers 502 with the underlying reason when the backend is unreachable', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await loadRoute()

    const res = await GET(
      new NextRequest('http://localhost/api/node/queries', {
        headers: { cookie: 'session=s1' },
      }),
      ctx(['queries'])
    )

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      error: 'Failed to reach the query service: ECONNREFUSED',
    })
  })

  it('answers 502 for a non-Error rejection', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue('just a string')
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await loadRoute()

    const res = await POST(mutationRequest('POST', '{}'), ctx(['queries', '8']))

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Failed to reach the query service: Proxy error' })
  })
})

describe('response body decoding', () => {
  it.each([
    ['', 'plain body'],
    ['text/csv', 'a,b\n1,2'],
    ['application/json; charset=utf-8', '{"id":8}'],
    ['application/vnd.api+json', '{"id":8}'],
    ['application/xml', '<q id="8"/>'],
    ['image/svg+xml', '<svg/>'],
    ['application/javascript', 'export default 1'],
  ])('reads %s as text', async (contentType, payload) => {
    stubFetch(
      new Response(payload, {
        status: 200,
        headers: contentType ? { 'content-type': contentType } : {},
      })
    )
    const { GET } = await loadRoute()

    const res = await GET(
      new NextRequest('http://localhost/api/node/queries/8/results', {
        headers: { cookie: 'session=s1' },
      }),
      ctx(['queries', '8', 'results'])
    )

    expect(await res.text()).toBe(payload)
  })
})
