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

describe('logout route', () => {
  it('notifies Redash, clears the local session cookies, and returns 200', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute('https://redash.example')
    const req = new NextRequest('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { cookie: 'session=session-123; csrf_token=csrf-456' },
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ message: 'Logged out.' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://redash.example/logout',
      expect.objectContaining({
        method: 'GET',
        headers: { Cookie: 'session=session-123; csrf_token=csrf-456' },
      })
    )
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('session=')
    expect(setCookie).toContain('csrf_token=')
    expect(setCookie).toContain('redash_api_key=')
    expect(setCookie).toContain('Max-Age=0')
  })
})
