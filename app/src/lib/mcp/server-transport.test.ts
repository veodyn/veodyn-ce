// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CREDENTIAL, REDASH, SESSION_CREDENTIAL } from './mcp-test-fixtures'

async function load() {
  vi.resetModules()
  process.env.REDASH_URL = REDASH
  return import('./server-transport')
}

function stubFetch(status = 200, body: unknown = { ok: true }) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', spy)
  return spy
}

function sent(spy: ReturnType<typeof stubFetch>) {
  const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
  return { url, init, headers: new Headers(init.headers as HeadersInit) }
}

beforeEach(() => {
  process.env.REDASH_URL = REDASH
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.REDASH_URL
})

describe('serverTransport', () => {
  it('sends Key auth and the /api prefix, with params as repeated query keys', async () => {
    const { serverTransport } = await load()
    const spy = stubFetch(200, { id: 5 })
    const result = await serverTransport(CREDENTIAL).get('queries', {
      q: 'trips',
      tags: ['a', 'b'],
      page: 2,
      order: undefined,
    })
    expect(result).toEqual({ id: 5 })
    const { url, init, headers } = sent(spy)
    expect(url).toBe(`${REDASH}/api/queries?q=trips&tags=a&tags=b&page=2`)
    expect(init.method).toBe('GET')
    expect(headers.get('authorization')).toBe('Key abc123')
    expect(headers.get('cookie')).toBeNull()
  })

  it('sends a bare path with no query string when there are no params', async () => {
    const { serverTransport } = await load()
    const spy = stubFetch()
    await serverTransport(CREDENTIAL).get('queries/5')
    expect(sent(spy).url).toBe(`${REDASH}/api/queries/5`)
  })

  it('posts the body as JSON and passes the signal on', async () => {
    const { serverTransport } = await load()
    const spy = stubFetch()
    const controller = new AbortController()
    await serverTransport(CREDENTIAL).post('queries/5/results', { max_age: 0 }, controller.signal)
    const { url, init } = sent(spy)
    expect(url).toBe(`${REDASH}/api/queries/5/results`)
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ max_age: 0 }))
    expect(init.signal).toBe(controller.signal)
  })

  it('deletes with the params', async () => {
    const { serverTransport } = await load()
    const spy = stubFetch()
    await serverTransport(CREDENTIAL).del('jobs/j1', { a: 1 })
    const { url, init } = sent(spy)
    expect(url).toBe(`${REDASH}/api/jobs/j1?a=1`)
    expect(init.method).toBe('DELETE')
  })

  it('forwards only the session cookie and csrf token for a session caller', async () => {
    const { serverTransport } = await load()
    const spy = stubFetch()
    await serverTransport(SESSION_CREDENTIAL).post('queries', {})
    const { headers } = sent(spy)
    expect(headers.get('cookie')).toBe('session=sess-1')
    expect(headers.get('x-csrf-token')).toBe('csrf-1')
    expect(headers.get('authorization')).toBeNull()
  })

  it('answers a refused status as an ApiError carrying the status', async () => {
    const { serverTransport } = await load()
    stubFetch(404, { message: 'Not found' })
    const error = await serverTransport(CREDENTIAL)
      .get('queries/9')
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ name: 'ApiError', status: 404 })
  })

  it('leaves an unrecognised credential as the unauthorized error', async () => {
    const { serverTransport } = await load()
    const { McpUnauthorized } = await import('./redash-caller')
    stubFetch(403, {})
    await expect(serverTransport(CREDENTIAL).get('queries/9')).rejects.toBeInstanceOf(McpUnauthorized)
  })
})

describe('credentialReader', () => {
  it('reads an /api path as the caller, keyed by the caller, and answers null on any failure', async () => {
    const { credentialReader } = await load()
    const spy = stubFetch(200, { count: 1 })
    const { get, key } = credentialReader(CREDENTIAL, 'mcp:7')
    expect(key).toBe('mcp:7')
    expect(await get('/api/queries?tags=x', new AbortController().signal)).toEqual({ count: 1 })
    expect(sent(spy).url).toBe(`${REDASH}/api/queries?tags=x`)
    expect(sent(spy).headers.get('authorization')).toBe('Key abc123')
    stubFetch(500, 'down')
    expect(await get('/api/queries', new AbortController().signal)).toBeNull()
  })
})
