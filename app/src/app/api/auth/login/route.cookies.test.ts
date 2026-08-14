// @vitest-environment node
//
// `Secure` on the three credential cookies login mints. Both directions are
// asserted on purpose: the production case is the protection, and the
// non-production case is what keeps local development and the e2e suite (both
// plain HTTP, where a browser silently drops a Secure cookie) working.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

// COOKIE_SECURE is evaluated at module load, so NODE_ENV has to be in place
// before the route (and the helper it imports) is first imported.
async function loadRoute(nodeEnv: string) {
  vi.stubEnv('REDASH_URL', 'https://redash.example')
  vi.stubEnv('NODE_ENV', nodeEnv)
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

// The four upstream calls a successful login makes: the login page, the form
// POST, /api/session, then /api/users/:id for the personal API key. The user id
// matters — without it the route never reaches the redash_api_key branch.
function upstreamSuccess() {
  return vi
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
        headers: { location: '/', 'set-cookie': 'session=session-456; Path=/; HttpOnly' },
      })
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ user: { id: 7, email: 'admin@example.com' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ api_key: 'user-key-789' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
}

function cookieNamed(res: Response, name: string) {
  const found = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))
  expect(found, `no Set-Cookie for ${name}`).toBeDefined()
  return found as string
}

const CREDENTIAL_COOKIES = ['session', 'csrf_token', 'redash_api_key']

describe('login cookie attributes', () => {
  it('marks every credential cookie Secure in production', async () => {
    vi.stubGlobal('fetch', upstreamSuccess())
    const { POST } = await loadRoute('production')

    const res = await POST(loginRequest())

    expect(res.status).toBe(200)
    for (const name of CREDENTIAL_COOKIES) {
      expect(cookieNamed(res, name)).toContain('Secure')
    }
  })

  it('leaves them non-Secure outside production, so plain-HTTP local and e2e still log in', async () => {
    vi.stubGlobal('fetch', upstreamSuccess())
    const { POST } = await loadRoute('development')

    const res = await POST(loginRequest())

    expect(res.status).toBe(200)
    for (const name of CREDENTIAL_COOKIES) {
      expect(cookieNamed(res, name)).not.toContain('Secure')
    }
  })
})
