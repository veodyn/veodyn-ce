// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CREDENTIAL, REDASH, SESSION_CREDENTIAL } from './mcp-test-fixtures'

const SECRET = 'a-token-secret-of-sufficient-length'

async function load(secret = SECRET) {
  vi.resetModules()
  process.env.REDASH_URL = REDASH
  vi.doMock('@/lib/env', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/lib/env')>()
    return { ...original, env: { ...original.env, VEODYN_AI__TOKEN_SECRET: secret } }
  })
  return import('./identity')
}

function stubFetch(status: number, body: unknown) {
  const spy = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', spy)
  return spy
}

const signal = () => new AbortController().signal

beforeEach(() => {
  process.env.REDASH_URL = REDASH
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('@/lib/env')
  delete process.env.REDASH_URL
})

describe('verifyCaller', () => {
  it('returns the session user for an API key, asking node as that key', async () => {
    const { verifyCaller } = await load()
    const spy = stubFetch(200, { user: { id: 7 } })
    expect(await verifyCaller(CREDENTIAL, signal())).toEqual({ userId: 7 })
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${REDASH}/api/session`)
    expect(new Headers(init.headers as HeadersInit).get('authorization')).toBe('Key abc123')
  })

  it('returns the session user for a session cookie', async () => {
    const { verifyCaller } = await load()
    const spy = stubFetch(200, { user: { id: 12 } })
    expect(await verifyCaller(SESSION_CREDENTIAL, signal())).toEqual({ userId: 12 })
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(new Headers(init.headers as HeadersInit).get('cookie')).toBe('session=sess-1')
  })

  it('returns null when node answers 404 please login for an unknown key', async () => {
    const { verifyCaller } = await load()
    stubFetch(404, 'Please login to access this resource.')
    expect(await verifyCaller(CREDENTIAL, signal())).toBeNull()
  })

  it('returns null on 401 and 403', async () => {
    const { verifyCaller } = await load()
    stubFetch(401, '')
    expect(await verifyCaller(SESSION_CREDENTIAL, signal())).toBeNull()
    stubFetch(403, '')
    expect(await verifyCaller(CREDENTIAL, signal())).toBeNull()
  })

  it('returns null without calling node when the request carries no credential', async () => {
    const { verifyCaller } = await load()
    const spy = stubFetch(200, { user: { id: 1 } })
    expect(await verifyCaller({ apiKey: null, session: null, csrfToken: null }, signal())).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('returns null when the session body names no user id', async () => {
    const { verifyCaller } = await load()
    stubFetch(200, { user: {} })
    expect(await verifyCaller(CREDENTIAL, signal())).toBeNull()
  })

  it('lets a server fault through rather than reading it as no identity', async () => {
    const { verifyCaller } = await load()
    stubFetch(500, 'boom')
    await expect(verifyCaller(CREDENTIAL, signal())).rejects.toThrow('500')
  })
})

describe('mcpSubjectToken', () => {
  it('mints a token for the given user that verifies under the secret', async () => {
    const { mcpSubjectToken } = await load()
    const { verifyAiToken } = await import('@/lib/ai-token')
    const verified = verifyAiToken(mcpSubjectToken(7), SECRET)
    expect(verified).toMatchObject({ subject: 7 })
  })

  it('refuses when the token secret is not configured', async () => {
    const { mcpSubjectToken } = await load('')
    expect(() => mcpSubjectToken(7)).toThrow(/token secret/i)
  })
})
