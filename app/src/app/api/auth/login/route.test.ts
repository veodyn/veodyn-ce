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

function loginRequest() {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'secret' }),
  })
}

describe('login route', () => {
  it('returns 200 and sets the upstream session cookie after a successful login', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('<input name="csrf_token" value="csrf-123">', {
          status: 200,
          headers: { 'set-cookie': 'csrf_token=csrf-123; Path=/' },
        })
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location: '/',
            'set-cookie': 'session=session-456; Path=/; HttpOnly',
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: { email: 'admin@example.com' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute('https://redash.example')
    const res = await POST(loginRequest())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user: { email: 'admin@example.com' } })
    expect(res.headers.get('set-cookie')).toContain('session=session-456')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('returns 401 when the upstream rejects the credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('<input name="csrf_token" value="csrf-123">', {
          status: 200,
          headers: { 'set-cookie': 'csrf_token=csrf-123; Path=/' },
        })
      )
      .mockResolvedValueOnce(new Response('Invalid credentials', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute('https://redash.example')
    const res = await POST(loginRequest())

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ message: 'Invalid email or password.' })
  })
})
