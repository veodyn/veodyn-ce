// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
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

function sessionRequest() {
  return new NextRequest('http://localhost/api/auth/session', {
    headers: { cookie: 'session=session-123; redash_api_key=key-456' },
  })
}

describe('session route', () => {
  it('returns the upstream session payload unchanged on success', async () => {
    const payload = {
      user: { id: 7, name: 'Admin' },
      client_config: { feature_flags: {} },
      messages: [],
    }
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute('https://redash.example')
    const res = await GET(sessionRequest())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://redash.example/api/session',
      expect.objectContaining({
        method: 'GET',
        headers: { Cookie: 'session=session-123; redash_api_key=key-456' },
      })
    )
  })

  it('returns an unhandled upstream failure status', async () => {
    const fetchMock = vi.fn(async () => new Response('Unavailable', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute('https://redash.example')
    const res = await GET(sessionRequest())

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ message: 'Session check failed.' })
  })
})
