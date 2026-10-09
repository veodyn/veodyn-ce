// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadRoute() {
  vi.resetModules()
  process.env.REDASH_URL = 'https://redash.example'
  return import('./route')
}

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.REDASH_URL
})

const PARAMS = { params: Promise.resolve({ token: 'tok' }) }
const TABLE = { columns: [{ name: 'n', friendly_name: 'n', type: 'integer' }], rows: [{ n: 1 }] }
const UPSTREAM = {
  type: 'CHART',
  name: 'Riders',
  description: '',
  options: {},
  query_result: { data: TABLE, retrieved_at: '2026-10-08T10:00:00Z' },
}

function request(search: string) {
  return new Request(`http://localhost/api/public/visualizations/tok${search}`)
}

function upstreamSpy(body: unknown = UPSTREAM, init?: ResponseInit) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(body, init))
}

describe('GET /api/public/visualizations/[token] parameters', () => {
  it('calls upstream with exactly the bare URL when there is no p_ key', async () => {
    const spy = upstreamSpy()
    const { GET } = await loadRoute()

    await GET(request('?refresh=30&other=1'), PARAMS)

    expect(spy.mock.calls[0]?.[0]).toBe('https://redash.example/api/visualizations/public/tok')
  })

  it('forwards valid p_ keys in sorted order and encodes values', async () => {
    const spy = upstreamSpy()
    const { GET } = await loadRoute()

    const response = await GET(request('?p_route=MT 020&p_a=1&refresh=30'), PARAMS)

    expect(response.status).toBe(200)
    expect(spy.mock.calls[0]?.[0]).toBe(
      'https://redash.example/api/visualizations/public/tok?p_a=1&p_route=MT%20020'
    )
  })

  it('forwards a value of exactly 200 characters and a key name of exactly 64', async () => {
    const spy = upstreamSpy()
    const { GET } = await loadRoute()
    const key = `p_${'k'.repeat(64)}`

    const response = await GET(request(`?${key}=${'v'.repeat(200)}`), PARAMS)

    expect(response.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a repeated key', '?p_route=a&p_route=b'],
    ['a key with a forbidden character', '?p_ro-ute=a'],
    ['an empty key name', '?p_=a'],
    ['a key name over 64 characters', `?p_${'k'.repeat(65)}=a`],
    ['a value over 200 characters', `?p_route=${'v'.repeat(201)}`],
    ['more than 10 keys', `?${Array.from({ length: 11 }, (_, n) => `p_k${n}=a`).join('&')}`],
  ])('answers 404 itself for %s without calling upstream', async (_label, search) => {
    const spy = upstreamSpy()
    const { GET } = await loadRoute()

    const response = await GET(request(search), PARAMS)
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe('visualization not available')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(spy).not.toHaveBeenCalled()
  })

  it('accepts exactly 10 keys', async () => {
    const spy = upstreamSpy()
    const { GET } = await loadRoute()

    await GET(request(`?${Array.from({ length: 10 }, (_, n) => `p_k${n}=a`).join('&')}`), PARAMS)

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('passes a 202 through with its normalised body, Retry-After and CORS', async () => {
    upstreamSpy(
      { ...UPSTREAM, query_result: null, status: 'pending', parameters: { route: 'MT020' } },
      { status: 202, headers: { 'Retry-After': '2' } }
    )
    const { GET } = await loadRoute()

    const response = await GET(request('?p_route=MT020'), PARAMS)
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(response.headers.get('retry-after')).toBe('2')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-expose-headers')).toBe('Retry-After')
    expect(body).toEqual({
      visualization: { type: 'CHART', name: 'Riders', description: '', options: {} },
      data: null,
      status: 'pending',
    })
  })

  it('passes an upstream 503 with a body through, with Retry-After', async () => {
    upstreamSpy(
      { ...UPSTREAM, query_result: null, status: 'unavailable' },
      { status: 503, headers: { 'Retry-After': '30' } }
    )
    const { GET } = await loadRoute()

    const response = await GET(request('?p_route=MT020'), PARAMS)

    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('30')
    expect((await response.json()).status).toBe('unavailable')
  })

  it('keeps answering 502 for an upstream 503 whose body is not a visualization', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>down</html>', { status: 503 }))
    const { GET } = await loadRoute()

    const response = await GET(request('?p_route=MT020'), PARAMS)

    expect(response.status).toBe(502)
  })

  it('exposes Retry-After on every status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 404 }))
    const { GET } = await loadRoute()

    const response = await GET(request(''), PARAMS)

    expect(response.headers.get('access-control-expose-headers')).toBe('Retry-After')
  })

  it('exposes Retry-After on the preflight', async () => {
    const { OPTIONS } = await loadRoute()

    expect(OPTIONS().headers.get('access-control-expose-headers')).toBe('Retry-After')
  })
})
