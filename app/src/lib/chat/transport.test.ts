import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserTransport } from './transport'

function respond(body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('browserTransport', () => {
  it('get builds /api/node/<path> with the params', async () => {
    const fetchMock = respond({ id: 5 })
    const result = await browserTransport.get('queries/5', { include: 'x', page: 2 })
    expect(result).toEqual({ id: 5 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/api/node/queries/5')
    expect(parsed.searchParams.get('include')).toBe('x')
    expect(parsed.searchParams.get('page')).toBe('2')
    expect(init.method).toBe('GET')
  })

  it('post sends the body as JSON', async () => {
    const fetchMock = respond({ id: 5 })
    await browserTransport.post('queries/5', { name: 'a' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(new URL(url).pathname).toBe('/api/node/queries/5')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ name: 'a' }))
  })

  it('del puts params on the query string', async () => {
    const fetchMock = respond({})
    await browserTransport.del('queries/5', { expected_updated_at: '2026-10-24T10:00:00.123Z' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(new URL(url).searchParams.get('expected_updated_at')).toBe('2026-10-24T10:00:00.123Z')
    expect(init.method).toBe('DELETE')
  })

  it('passes the abort signal through', async () => {
    const fetchMock = respond({})
    const controller = new AbortController()
    await browserTransport.get('queries/5', undefined, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})
