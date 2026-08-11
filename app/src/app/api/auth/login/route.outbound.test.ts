// @vitest-environment node
//
// What LEAVES the process during the login dance. The four hops each carry a
// credential, and a dropped one does not show up in the returned status: a
// form POST without the jar from step 1 fails CSRF, a session check without
// the cookie minted in step 2 is anonymous, and a key lookup that quietly
// authenticates as somebody else hands the caller the wrong api_key.
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

function loginRequest() {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'sw0rdfish' }),
  })
}

type FetchCall = [string, RequestInit]

function callAt(mock: ReturnType<typeof vi.fn>, index: number): FetchCall {
  const call = mock.mock.calls[index] as FetchCall | undefined
  if (!call) throw new Error(`Expected an outbound fetch at index ${index}`)
  return call
}

function headersOf(call: FetchCall): Record<string, string> {
  return Object.fromEntries(
    Object.entries((call[1]?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
      k.toLowerCase(),
      v,
    ])
  )
}

function loginPage() {
  return new Response('<input name="csrf_token" value="csrf-123">', {
    status: 200,
    headers: { 'set-cookie': 'csrf_token=csrf-123; Path=/' },
  })
}

function loginRedirect() {
  return new Response(null, {
    status: 302,
    headers: { location: '/', 'set-cookie': 'session=session-456; Path=/; HttpOnly' },
  })
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** The full happy path: login page, form POST, session, user key lookup. */
function happyPathFetch() {
  return vi
    .fn()
    .mockResolvedValueOnce(loginPage())
    .mockResolvedValueOnce(loginRedirect())
    .mockResolvedValueOnce(jsonResponse({ user: { id: 7, email: 'admin@example.com' } }))
    .mockResolvedValueOnce(jsonResponse({ id: 7, api_key: 'user-key-abc' }))
}

describe('login route outbound requests', () => {
  it('form-posts the scraped token, the credentials and the login-page cookie jar', async () => {
    const fetchMock = happyPathFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    await POST(loginRequest())

    const [pageUrl, pageOpts] = callAt(fetchMock, 0)
    expect(pageUrl).toBe('https://redash.example/login')
    expect(pageOpts.method).toBe('GET')

    const postCall = callAt(fetchMock, 1)
    expect(postCall[0]).toBe('https://redash.example/login')
    expect(postCall[1].method).toBe('POST')
    // Redash's /login is a form endpoint, not a JSON API.
    expect(headersOf(postCall)['content-type']).toBe('application/x-www-form-urlencoded')
    // The cookie jar from the GET has to ride along or Flask-WTF cannot match
    // the token in the body against the one in the session.
    expect(headersOf(postCall)['cookie']).toBe('csrf_token=csrf-123')

    const form = new URLSearchParams(String(postCall[1].body))
    expect(form.get('email')).toBe('admin@example.com')
    expect(form.get('password')).toBe('sw0rdfish')
    expect(form.get('csrf_token')).toBe('csrf-123')
  })

  it('checks the session with the jar merged from the login redirect', async () => {
    const fetchMock = happyPathFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    await POST(loginRequest())

    const sessionCall = callAt(fetchMock, 2)
    expect(sessionCall[0]).toBe('https://redash.example/api/session')
    const cookie = headersOf(sessionCall)['cookie'] ?? ''
    // Both halves matter: the session cookie proves who, the csrf cookie is
    // what step 2 handed back. Losing the session cookie here makes this an
    // anonymous request that just happens to 401 into a generic 500.
    expect(cookie).toContain('session=session-456')
    expect(cookie).toContain('csrf_token=csrf-123')
  })

  it('looks the api key up as the session user, by cookie and never by key', async () => {
    const fetchMock = happyPathFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    await POST(loginRequest())

    expect(fetchMock).toHaveBeenCalledTimes(4)
    const userCall = callAt(fetchMock, 3)
    // The id comes from the session payload, not from anything the caller sent.
    expect(userCall[0]).toBe('https://redash.example/api/users/7')
    expect(headersOf(userCall)['cookie']).toContain('session=session-456')
    expect(headersOf(userCall)['authorization']).toBeUndefined()
  })

  it('sets session, csrf_token and redash_api_key with the right visibility', async () => {
    const fetchMock = happyPathFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    const res = await POST(loginRequest())

    expect(res.status).toBe(200)
    const cookies = res.headers.getSetCookie()
    const find = (name: string) => cookies.find((c) => c.startsWith(`${name}=`)) ?? ''

    expect(find('session')).toContain('session=session-456')
    expect(find('session')).toContain('HttpOnly')
    expect(find('redash_api_key')).toContain('redash_api_key=user-key-abc')
    expect(find('redash_api_key')).toContain('HttpOnly')
    // The client reads csrf_token from document.cookie to set X-CSRF-TOKEN, so
    // this one must NOT be httpOnly.
    expect(find('csrf_token')).toContain('csrf_token=csrf-123')
    expect(find('csrf_token')).not.toContain('HttpOnly')
  })

  it('skips the key lookup when the session payload has no user id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginPage())
      .mockResolvedValueOnce(loginRedirect())
      .mockResolvedValueOnce(jsonResponse({ user: { email: 'admin@example.com' } }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    const res = await POST(loginRequest())

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(res.headers.getSetCookie().some((c) => c.startsWith('redash_api_key='))).toBe(false)
  })

  it.each([
    ['the lookup answers non-200', new Response('nope', { status: 403 })],
    ['the user carries no api_key', jsonResponse({ id: 7 })],
  ])('still signs the user in when %s', async (_label, userResponse) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginPage())
      .mockResolvedValueOnce(loginRedirect())
      .mockResolvedValueOnce(jsonResponse({ user: { id: 7 } }))
      .mockResolvedValueOnce(userResponse)
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    const res = await POST(loginRequest())

    expect(res.status).toBe(200)
    const cookies = res.headers.getSetCookie()
    expect(cookies.some((c) => c.startsWith('session=session-456'))).toBe(true)
    expect(cookies.some((c) => c.startsWith('redash_api_key='))).toBe(false)
  })

  it('still signs the user in when the key lookup throws', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginPage())
      .mockResolvedValueOnce(loginRedirect())
      .mockResolvedValueOnce(jsonResponse({ user: { id: 7 } }))
      .mockRejectedValueOnce(new Error('socket hang up'))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    const res = await POST(loginRequest())

    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie().some((c) => c.startsWith('redash_api_key='))).toBe(false)
  })

  it('sets no session cookie when the redirect minted none', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('<input name="csrf_token" value="csrf-123">', { status: 200 })
      )
      // No Location header at all, which is a redirect that is still not /setup.
      .mockResolvedValueOnce(new Response(null, { status: 302 }))
      .mockResolvedValueOnce(jsonResponse({ user: { email: 'admin@example.com' } }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    const res = await POST(loginRequest())

    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie()).toEqual([])
  })
})
