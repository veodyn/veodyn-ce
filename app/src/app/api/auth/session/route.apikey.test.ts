// @vitest-environment node
//
// The self-heal branch: a session minted before the API-key flow (or one whose
// `redash_api_key` cookie was lost) re-fetches the key through the session that
// was just validated. What matters here is the SECOND outbound request: which
// user it asks for, which credential it carries, and that a failure of it is
// non-fatal to the session check itself.
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

const SESSION_PAYLOAD = { user: { id: 7, name: 'Admin' }, client_config: {}, messages: [] }

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function requestWithout(apiKeyCookie: boolean) {
  return new NextRequest('http://localhost/api/auth/session', {
    headers: {
      cookie: apiKeyCookie
        ? 'session=session-123; redash_api_key=already-here'
        : 'session=session-123',
    },
  })
}

type FetchCall = [string, RequestInit]

function callAt(mock: ReturnType<typeof vi.fn>, index: number): FetchCall {
  const call = mock.mock.calls[index] as FetchCall | undefined
  if (!call) throw new Error(`Expected an outbound fetch at index ${index}`)
  return call
}

describe('session route API-key self-heal', () => {
  it('re-fetches the key for the session user and sets it as an httpOnly cookie', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SESSION_PAYLOAD))
      .mockResolvedValueOnce(jsonResponse({ id: 7, api_key: 'healed-key' }))
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute()
    const res = await GET(requestWithout(false))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(SESSION_PAYLOAD)

    // The user id comes from the payload Redash just returned, not from
    // anything the caller supplied.
    const [url, opts] = callAt(fetchMock, 1)
    expect(url).toBe('https://redash.example/api/users/7')
    expect(opts.method).toBe('GET')
    const headers = opts.headers as Record<string, string>
    expect(headers['Cookie']).toBe('session=session-123')
    expect(headers['Authorization']).toBeUndefined()

    const setCookies = res.headers.getSetCookie()
    expect(setCookies.some((c) => c.startsWith('redash_api_key=healed-key'))).toBe(true)
    expect(setCookies.find((c) => c.startsWith('redash_api_key='))).toContain('HttpOnly')
  })

  it('does not re-fetch when the caller already holds the key cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SESSION_PAYLOAD))
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute()
    const res = await GET(requestWithout(true))

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('skips the lookup when the payload carries no user id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ client_config: {} }))
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute()
    const res = await GET(requestWithout(false))

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.headers.getSetCookie()).toEqual([])
  })

  it('leaves the cookie unset when the user lookup answers non-200', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SESSION_PAYLOAD))
      .mockResolvedValueOnce(new Response('forbidden', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute()
    const res = await GET(requestWithout(false))

    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie().some((c) => c.startsWith('redash_api_key='))).toBe(false)
  })

  it('leaves the cookie unset when the user carries no api_key', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SESSION_PAYLOAD))
      .mockResolvedValueOnce(jsonResponse({ id: 7 }))
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute()
    const res = await GET(requestWithout(false))

    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie().some((c) => c.startsWith('redash_api_key='))).toBe(false)
  })

  it('still answers 200 when the user lookup throws', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SESSION_PAYLOAD))
      .mockRejectedValueOnce(new Error('socket hang up'))
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute()
    const res = await GET(requestWithout(false))

    // Non-fatal: the cookie-session flow works without the key.
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(SESSION_PAYLOAD)
  })

  it('forwards the upstream Set-Cookie refresh and marks the answer no-store', async () => {
    const upstream = jsonResponse(SESSION_PAYLOAD)
    upstream.headers.append('set-cookie', 'session=rotated; Path=/; HttpOnly')
    upstream.headers.append('set-cookie', 'csrf_token=fresh-csrf; Path=/')
    const fetchMock = vi.fn().mockResolvedValueOnce(upstream)
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute()
    // Key cookie already present, so no self-heal write follows the forward.
    const res = await GET(requestWithout(true))

    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const setCookies = res.headers.getSetCookie()
    expect(setCookies).toContain('session=rotated; Path=/; HttpOnly')
    expect(setCookies).toContain('csrf_token=fresh-csrf; Path=/')
  })

  // Regression guard. `forwardSetCookies` appends Redash's `session` /
  // `csrf_token` refresh with headers.append. The self-heal used to follow it
  // with res.cookies.set(), and Next's ResponseCookies rebuilds the whole
  // Set-Cookie header from a map parsed when the response was created, which
  // never saw those raw appends, so writing `redash_api_key` DELETED them on
  // exactly the request that heals the key. The write is a raw append now, so
  // both survive.
  it('keeps the forwarded refresh when it also heals the key', async () => {
    const upstream = jsonResponse(SESSION_PAYLOAD)
    upstream.headers.append('set-cookie', 'session=rotated; Path=/; HttpOnly')
    upstream.headers.append('set-cookie', 'csrf_token=fresh-csrf; Path=/')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(upstream)
      .mockResolvedValueOnce(jsonResponse({ id: 7, api_key: 'healed-key' }))
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute()
    const res = await GET(requestWithout(false))

    const setCookies = res.headers.getSetCookie()
    expect(setCookies.some((c) => c.startsWith('redash_api_key=healed-key'))).toBe(true)
    expect(setCookies).toContain('session=rotated; Path=/; HttpOnly')
    expect(setCookies).toContain('csrf_token=fresh-csrf; Path=/')
  })
})
