// @vitest-environment node
//
// Regenerating an API key invalidates the `redash_api_key` cookie set at login,
// so the proxy refreshes it from the response. The dangerous half is the
// ownership check: an admin may regenerate ANOTHER user's key through the same
// endpoint, and adopting that key into this browser's cookie would silently
// swap the admin's identity for the target user's on every later request.
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function regenerateRequest(userId: string, cookie = 'session=s1; redash_api_key=old-key') {
  return new NextRequest(`http://localhost/api/node/users/${userId}/regenerate_api_key`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
  })
}

function ctxFor(userId: string) {
  return { params: Promise.resolve({ path: ['users', userId, 'regenerate_api_key'] }) }
}

function keyCookie(res: Response): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith('redash_api_key='))
}

describe('regenerate_api_key cookie refresh', () => {
  it('re-verifies the session and adopts the caller own new key', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ api_key: 'brand-new-key' }))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 7 } }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    const res = await POST(regenerateRequest('7'), ctxFor('7'))

    expect(res.status).toBe(200)

    // The ownership check is a fresh round-trip carrying ONLY the session
    // cookie: the stale key cookie would resolve to the pre-regeneration
    // identity, and the caller's other cookies have no business here.
    const verify = fetchMock.mock.calls[1]
    if (!verify) throw new Error('Expected the session verification fetch')
    expect(String(verify[0])).toBe('https://redash.example/api/session')
    expect((verify[1]?.headers as Record<string, string>)?.Cookie).toBe('session=s1')
    expect(verify[1]?.cache).toBe('no-store')

    expect(keyCookie(res)).toContain('redash_api_key=brand-new-key')
    expect(keyCookie(res)).toContain('HttpOnly')
  })

  it('does not adopt the key when an admin regenerates someone else', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ api_key: 'victim-key' }))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 7 } }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    // Session user 7 regenerating user 9's key.
    const res = await POST(regenerateRequest('9'), ctxFor('9'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ api_key: 'victim-key' })
    // Adopting it here would make this browser act as user 9.
    expect(keyCookie(res)).toBeUndefined()
  })

  it('skips the refresh entirely when the caller has no session cookie', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ api_key: 'brand-new-key' }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    const res = await POST(regenerateRequest('7', 'redash_api_key=old-key'), ctxFor('7'))

    expect(res.status).toBe(200)
    // One call only: no session to verify ownership against.
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(keyCookie(res)).toBeUndefined()
  })

  it.each([
    ['the session check answers non-200', jsonResponse({}, 401)],
    ['the session check has no user id', jsonResponse({ user: {} })],
  ])('does not adopt the key when %s', async (_label, sessionResponse) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ api_key: 'brand-new-key' }))
      .mockResolvedValueOnce(sessionResponse)
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    const res = await POST(regenerateRequest('7'), ctxFor('7'))

    expect(res.status).toBe(200)
    expect(keyCookie(res)).toBeUndefined()
  })

  it('does not adopt anything when the response carries no api_key', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 7 } }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    const res = await POST(regenerateRequest('7'), ctxFor('7'))

    expect(res.status).toBe(200)
    expect(keyCookie(res)).toBeUndefined()
  })

  it('still answers 200 when the verification round-trip throws', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ api_key: 'brand-new-key' }))
      .mockRejectedValueOnce(new Error('socket hang up'))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    const res = await POST(regenerateRequest('7'), ctxFor('7'))

    // Non-fatal: the user can re-login to refresh the cookie.
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ api_key: 'brand-new-key' })
    expect(keyCookie(res)).toBeUndefined()
  })

  it('skips the refresh when the regeneration itself failed', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ message: 'forbidden' }, 403))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    const res = await POST(regenerateRequest('7'), ctxFor('7'))

    expect(res.status).toBe(403)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(keyCookie(res)).toBeUndefined()
  })

  it('does not run the refresh on a GET of the same path', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ api_key: 'brand-new-key' }))
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute()
    const res = await GET(
      new NextRequest('http://localhost/api/node/users/7/regenerate_api_key', {
        headers: { cookie: 'session=s1; redash_api_key=old-key' },
      }),
      ctxFor('7')
    )

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(keyCookie(res)).toBeUndefined()
  })

  // Was a DEFECT. On the cookie-session path (a user with no `redash_api_key`
  // cookie yet) the proxy appends Redash's Set-Cookie refresh with
  // headers.append, then wrote the new key with res.cookies.set. NextResponse
  // builds its ResponseCookies map in the constructor, before those appends,
  // and every .set() rewrites the whole header from that stale map, so the
  // forwarded `session` / `csrf_token` refresh was DELETED. Same root cause as
  // the session route's self-heal. Fixed by appending the key raw instead.
  it('keeps the forwarded session refresh alongside the new key', async () => {
    const regenerated = jsonResponse({ api_key: 'brand-new-key' })
    regenerated.headers.append('set-cookie', 'session=rotated; Path=/; HttpOnly')
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(regenerated)
      .mockResolvedValueOnce(jsonResponse({ user: { id: 7 } }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    // No stored key, so the proxy uses cookie-session auth and forwards
    // Redash's Set-Cookie headers.
    const res = await POST(regenerateRequest('7', 'session=s1'), ctxFor('7'))

    expect(keyCookie(res)).toContain('redash_api_key=brand-new-key')
    expect(res.headers.getSetCookie()).toContain('session=rotated; Path=/; HttpOnly')
  })
})
