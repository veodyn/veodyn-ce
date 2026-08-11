// @vitest-environment node
//
// The refusal paths of the session check, plus the one rule the route's own
// header states: it must NEVER authenticate with an API key, because this
// round-trip is how the app decides who the caller is. A key would make every
// caller look like the key's owner.
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

function sessionRequest(cookie?: string) {
  return new NextRequest(
    'http://localhost/api/auth/session',
    cookie ? { headers: { cookie } } : undefined
  )
}

/** Headers of the nth outbound fetch, as a plain lowercased-key record. */
function outboundHeaders(mock: ReturnType<typeof vi.fn>, index = 0): Record<string, string> {
  const call = mock.mock.calls[index] as [string, RequestInit] | undefined
  if (!call) throw new Error(`Expected an outbound fetch at index ${index}`)
  const raw = (call[1]?.headers ?? {}) as Record<string, string>
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]))
}

describe('session route refusals', () => {
  it('answers 503 without calling Redash when REDASH_URL is unset', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute('')
    const res = await GET(sessionRequest('session=session-123'))

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ message: 'REDASH_URL not configured.' })
    // A blank base URL would otherwise make this a relative fetch.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 401 without calling Redash when the session cookie is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute('https://redash.example')
    // A `redash_api_key` cookie on its own must not stand in for a session:
    // that is exactly the substitution this route may not make.
    const res = await GET(sessionRequest('redash_api_key=key-456'))

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ message: 'Please login to continue.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([401, 403, 404])(
    'maps upstream %i onto a plain 401 "not authenticated"',
    async (status) => {
      const fetchMock = vi.fn(async () => new Response('nope', { status }))
      vi.stubGlobal('fetch', fetchMock)

      const { GET } = await loadRoute('https://redash.example')
      const res = await GET(sessionRequest('session=session-123'))

      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ message: 'Please login to continue.' })
    }
  )

  it('answers 502 when the backend is unreachable', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    vi.stubGlobal('fetch', fetchMock)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { GET } = await loadRoute('https://redash.example')
    const res = await GET(sessionRequest('session=session-123'))

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      message: 'Failed to connect to authentication server.',
    })
    expect(consoleError).toHaveBeenCalled()
  })

  it('sends the caller cookie and no Authorization header, whatever the outcome', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('nope', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute('https://redash.example')
    await GET(sessionRequest('session=session-123'))

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://redash.example/api/session')
    const headers = outboundHeaders(fetchMock)
    expect(headers['cookie']).toBe('session=session-123')
    // The whole point of this route: identity comes from the caller's cookie.
    expect(headers['authorization']).toBeUndefined()
  })
})
