import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cookieJar = new Map<string, string>()
const redashFetch = vi.hoisted(() => vi.fn())
const redashUrl = vi.hoisted(() => ({ value: 'http://redash.test' }))

const requestHeaders = new Map<string, string>()

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined,
  }),
  headers: async () => ({
    get: (name: string) => {
      if (name === 'cookie') {
        return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
      }
      return requestHeaders.get(name) ?? null
    },
  }),
}))

vi.mock('@/lib/redash-server', () => ({
  get REDASH_URL() {
    return redashUrl.value
  },
  redashFetch,
}))

import { readServerSession } from './server-session'

const SESSION_OK = {
  user: { id: 7, name: 'Ada', email: 'ada@example.test', permissions: ['create_query'] },
  client_config: { pageSize: 50 },
  messages: [],
  org_name: 'Veodyn',
  org_slug: 'default',
}

function answers(status: number, body: unknown = {}) {
  redashFetch.mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  })
}

const REAL_URL = process.env.NEXT_PUBLIC_REDASH_URL

beforeEach(() => {
  vi.clearAllMocks()
  cookieJar.clear()
  requestHeaders.clear()
  redashUrl.value = 'http://redash.test'
  process.env.NEXT_PUBLIC_REDASH_URL = 'http://redash.test'
})

afterEach(() => {
  if (REAL_URL === undefined) delete process.env.NEXT_PUBLIC_REDASH_URL
  else process.env.NEXT_PUBLIC_REDASH_URL = REAL_URL
})

describe('readServerSession', () => {
  it('declines to decide in mock mode, rather than reporting anonymous', async () => {
    delete process.env.NEXT_PUBLIC_REDASH_URL
    cookieJar.set('session', 'whatever')

    expect(await readServerSession()).toBeNull()
    // The distinction that matters: mock mode signs itself in on the client, so
    // answering `anonymous` here would bounce every demo visitor to /login.
    expect(redashFetch).not.toHaveBeenCalled()
  })

  it('does not ask Redash at all on a route the middleware marked public', async () => {
    // A share link, an embed or an invite. Nothing there reads the session, so
    // a round trip in front of that HTML buys nothing, and on an embed the
    // latency is the product. Only a SIGNED-IN reader would have paid it: an
    // outside recipient carries no cookie and short-circuits below anyway.
    requestHeaders.set('x-veodyn-public-route', '1')
    cookieJar.set('session', 'abc')

    // null, not anonymous: declining to ask is not a claim that nobody is here.
    expect(await readServerSession()).toBeNull()
    expect(redashFetch).not.toHaveBeenCalled()
  })

  it('reports anonymous without asking Redash when there is no session cookie', async () => {
    expect(await readServerSession()).toEqual({ status: 'anonymous' })
    expect(redashFetch).not.toHaveBeenCalled()
  })

  it('returns the payload and forwards the whole cookie header', async () => {
    cookieJar.set('session', 'abc')
    cookieJar.set('csrf_token', 'xyz')
    cookieJar.set('redash_api_key', 'key')
    answers(200, SESSION_OK)

    expect(await readServerSession()).toEqual({
      status: 'authenticated',
      payload: SESSION_OK,
      needsApiKeyHeal: false,
    })
    // Redash wants csrf_token alongside the session, so this must be the whole
    // header rather than the one cookie the gate above looked at.
    expect(redashFetch).toHaveBeenCalledWith('/api/session', {
      cookie: 'session=abc; csrf_token=xyz; redash_api_key=key',
    })
  })

  it('flags the api-key heal when the cookie is missing, and only then', async () => {
    cookieJar.set('session', 'abc')
    answers(200, SESSION_OK)

    const result = await readServerSession()
    expect(result).toMatchObject({ status: 'authenticated', needsApiKeyHeal: true })
  })

  it.each([401, 403, 404])('reports anonymous for a Redash %i', async (status) => {
    cookieJar.set('session', 'stale')
    answers(status, { message: 'nope' })

    expect(await readServerSession()).toEqual({ status: 'anonymous' })
  })

  it('declines to decide on a Redash 500, rather than signing the reader out', async () => {
    cookieJar.set('session', 'abc')
    answers(500, {})

    // A backend that fell over is not a verdict about who the reader is. Mapping
    // it to `anonymous` would redirect a signed-in user to /login over a blip.
    expect(await readServerSession()).toBeNull()
  })

  it('declines to decide when Redash is unreachable', async () => {
    cookieJar.set('session', 'abc')
    redashFetch.mockRejectedValue(new Error('ECONNREFUSED'))

    expect(await readServerSession()).toBeNull()
  })

  it('declines to decide on a 200 that carries no user id', async () => {
    cookieJar.set('session', 'abc')
    answers(200, { user: {}, client_config: {}, messages: [] })

    expect(await readServerSession()).toBeNull()
  })

  it('declines to decide when the server has no REDASH_URL configured', async () => {
    redashUrl.value = ''
    cookieJar.set('session', 'abc')

    expect(await readServerSession()).toBeNull()
    expect(redashFetch).not.toHaveBeenCalled()
  })
})
