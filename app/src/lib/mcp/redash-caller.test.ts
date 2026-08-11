// @vitest-environment node
//
// Exactly ONE credential establishes identity, and only that one goes to
// Redash. The first version forwarded the raw Cookie header, which on this
// origin carries `session`, `csrf_token` AND `redash_api_key`: three
// credentials, two of them secret, for a request that needed one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const REDASH = 'http://redash.test'

async function loadCaller() {
  vi.resetModules()
  process.env.REDASH_URL = REDASH
  return import('@/lib/mcp/redash-caller')
}

function sentHeaders(spy: ReturnType<typeof vi.spyOn>): Headers {
  return new Headers((spy.mock.calls[0][1] as RequestInit)?.headers as HeadersInit)
}

beforeEach(() => {
  process.env.REDASH_URL = REDASH
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.REDASH_URL
})

describe('resolveCredential', () => {
  it('takes an explicit Authorization key above everything else', async () => {
    const { resolveCredential } = await loadCaller()

    expect(
      resolveCredential('Key explicit', 'session=s; csrf_token=c; redash_api_key=stored')
    ).toEqual({ apiKey: 'explicit', session: null, csrfToken: null })
  })

  it('accepts Bearer as well as Key', async () => {
    const { resolveCredential } = await loadCaller()

    expect(resolveCredential('Bearer abc', null).apiKey).toBe('abc')
    expect(resolveCredential('bearer abc', null).apiKey).toBe('abc')
  })

  it('prefers the stored key over the session, as the ordinary proxy does', async () => {
    const { resolveCredential } = await loadCaller()

    // One identity order for the whole origin. A browser must not be a
    // different user here than it is through /api/node/*.
    expect(resolveCredential(null, 'session=s; csrf_token=c; redash_api_key=stored')).toEqual({
      apiKey: 'stored',
      session: null,
      csrfToken: null,
    })
  })

  it('still resolves after the CSRF cookie expires, so mutations keep working', async () => {
    const { resolveCredential } = await loadCaller()

    // Login writes `session` and `redash_api_key` for 30 days and `csrf_token`
    // only for the browser session, so this is what reopening the browser looks
    // like. Choosing the session here sends Redash a cookie-authenticated POST
    // with no X-CSRF-TOKEN, which Flask-WTF refuses: run_query then fails for a
    // caller the rest of the app serves fine. The key is CSRF-exempt.
    expect(resolveCredential(null, 'session=s; redash_api_key=stored')).toEqual({
      apiKey: 'stored',
      session: null,
      csrfToken: null,
    })
  })

  it('falls back to the session when no key was stored', async () => {
    const { resolveCredential } = await loadCaller()

    expect(resolveCredential(null, 'session=s; csrf_token=c; theme=dark')).toEqual({
      apiKey: null,
      session: 's',
      csrfToken: 'c',
    })
  })

  it('carries the CSRF token with the session', async () => {
    const { resolveCredential } = await loadCaller()

    expect(resolveCredential(null, 'session=s; csrf_token=c; theme=dark')).toEqual({
      apiKey: null,
      session: 's',
      csrfToken: 'c',
    })
  })

  it('finds nothing in a cookie header that carries no credential', async () => {
    const { resolveCredential, hasCredential } = await loadCaller()

    // `Cookie: theme=dark` used to count as a credential, so an anonymous
    // caller got past the gate and had the endpoint call Redash for them.
    const credential = resolveCredential(null, 'theme=dark; sidebar=open')

    expect(credential).toEqual({ apiKey: null, session: null, csrfToken: null })
    expect(hasCredential(credential)).toBe(false)
  })

  it('ignores an empty or malformed header', async () => {
    const { resolveCredential, hasCredential } = await loadCaller()

    expect(hasCredential(resolveCredential(null, ''))).toBe(false)
    expect(hasCredential(resolveCredential('', null))).toBe(false)
    expect(hasCredential(resolveCredential('Basic abc', null))).toBe(false)
    expect(hasCredential(resolveCredential(null, '=nonsense;;'))).toBe(false)
  })
})

describe('callRedash', () => {
  it('sends the API key and no cookie at all', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }))
    const { callRedash } = await loadCaller()

    await callRedash('/api/queries', { apiKey: 'k', session: null, csrfToken: null })

    const headers = sentHeaders(spy)
    expect(headers.get('Authorization')).toBe('Key k')
    expect(headers.get('Cookie')).toBeNull()
  })

  it('rebuilds a lone session cookie rather than forwarding the caller jar', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }))
    const { callRedash } = await loadCaller()

    await callRedash('/api/queries', { apiKey: null, session: 'sess', csrfToken: 'tok' })

    const headers = sentHeaders(spy)
    expect(headers.get('Cookie')).toBe('session=sess')
    expect(headers.get('Cookie')).not.toContain('redash_api_key')
    expect(headers.get('Authorization')).toBeNull()
  })

  it('sends the CSRF token with a session, or Redash refuses every mutation', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }))
    const { callRedash } = await loadCaller()

    await callRedash(
      '/api/queries/1/results',
      { apiKey: null, session: 'sess', csrfToken: 'tok' },
      { method: 'POST', body: {} }
    )

    expect(sentHeaders(spy).get('X-CSRF-TOKEN')).toBe('tok')
  })

  it('does not send a CSRF header on the API-key path, which does not use one', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }))
    const { callRedash } = await loadCaller()

    await callRedash('/api/queries', { apiKey: 'k', session: null, csrfToken: null })

    expect(sentHeaders(spy).get('X-CSRF-TOKEN')).toBeNull()
  })
})
