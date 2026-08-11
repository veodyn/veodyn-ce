// @vitest-environment node
//
// Every way the login dance can refuse. Each step of the flow has its own
// failure mode and its own status, and getting one wrong sends the client to
// the wrong screen (a setup wizard instead of a password retry, or vice versa).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

async function loadRoute(redashUrl: string) {
  vi.stubEnv('REDASH_URL', redashUrl)
  vi.resetModules()
  return import('./route')
}

function loginRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const CREDENTIALS = { email: 'admin@example.com', password: 'secret' }

function loginPage(csrf = 'csrf-123') {
  return new Response(`<input name="csrf_token" value="${csrf}">`, {
    status: 200,
    headers: { 'set-cookie': `csrf_token=${csrf}; Path=/` },
  })
}

describe('login route refusals', () => {
  it.each([
    ['no body at all', {}],
    ['a missing password', { email: 'admin@example.com' }],
    ['a missing email', { password: 'secret' }],
    ['an empty password', { email: 'admin@example.com', password: '' }],
  ])('answers 400 for %s without calling Redash', async (_label, body) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute('https://redash.example')
    const res = await POST(loginRequest(body))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ message: 'Email and password are required.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 400 for a body that is not JSON at all', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute('https://redash.example')
    const res = await POST(loginRequest('not json'))

    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 503 when REDASH_URL is unset', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute('')
    const res = await POST(loginRequest(CREDENTIALS))

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ message: 'REDASH_URL not configured.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 503 needsSetup when the login page carries no csrf token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<html>setup</html>', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute('https://redash.example')
    const res = await POST(loginRequest(CREDENTIALS))

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      message: 'The query service is not ready. Organization may need setup.',
      needsSetup: true,
    })
    // It must stop after the GET rather than post credentials with no token.
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('answers 400 with a retry hint when Redash rejects the csrf token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginPage())
      .mockResolvedValueOnce(new Response('CSRF token expired', { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute('https://redash.example')
    const res = await POST(loginRequest(CREDENTIALS))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      message: 'Login failed. CSRF token invalid, please retry.',
    })
  })

  it('answers 401 when Redash re-renders the form (200, not 302)', async () => {
    // The subtle one: bad credentials come back as a 200 HTML page, not a 4xx.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginPage())
      .mockResolvedValueOnce(new Response('<html>Wrong password</html>', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute('https://redash.example')
    const res = await POST(loginRequest(CREDENTIALS))

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ message: 'Invalid email or password.' })
    expect(res.headers.getSetCookie()).toEqual([])
  })

  it('answers 403 needsSetup when the redirect points at /setup', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginPage())
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: '/setup' } })
      )
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute('https://redash.example')
    const res = await POST(loginRequest(CREDENTIALS))

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      message: 'Organization setup required.',
      needsSetup: true,
    })
    // No session is minted for a half-configured org.
    expect(res.headers.getSetCookie()).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('answers 500 when the post-login session check fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginPage())
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: '/', 'set-cookie': 'session=s456; Path=/' },
        })
      )
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute('https://redash.example')
    const res = await POST(loginRequest(CREDENTIALS))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      message: 'Login succeeded but failed to load session.',
    })
  })

  it('answers 502 when the backend is unreachable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { POST } = await loadRoute('https://redash.example')
    const res = await POST(loginRequest(CREDENTIALS))

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      message: 'Failed to connect to authentication server.',
    })
    expect(consoleError).toHaveBeenCalled()
  })
})
