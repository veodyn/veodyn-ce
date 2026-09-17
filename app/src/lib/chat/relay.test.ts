import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENDPOINT, THREAD, json, mockChatModules, signedIn, thread, unmockChatModules } from './relay-test-harness'

afterEach(unmockChatModules)

async function threadsRoute(options: Parameters<typeof mockChatModules>[0] = {}) {
  mockChatModules(options)
  return import('@/app/api/ai/chat/threads/route')
}

describe('chat relay gate', () => {
  it.each([
    ['chat off', { chat: false }, 403],
    ['ai off', { enabled: false }, 403],
    ['mock mode', { realMode: false }, 403],
    ['no endpoint', { endpoint: null }, 503],
  ])('answers %s with %i before calling anything', async (_label, options, status) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await threadsRoute(options)
    expect((await GET(signedIn())).status).toBe(status)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a caller without a session', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const { GET } = await threadsRoute()
    expect((await GET(new Request('http://localhost/api/ai/chat/threads'))).status).toBe(401)
  })
})

describe('chat JSON relay', () => {
  it('sends the relay key and the user token, and never the cookie', async () => {
    const fetchMock = vi.fn(async () => json({ threads: [thread()], nextOffset: null }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await threadsRoute()
    const response = await GET(signedIn({ url: 'http://localhost/api/ai/chat/threads?offset=50' }))
    expect(response.status).toBe(200)
    expect((await response.json()).threads[0].id).toBe(THREAD)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${ENDPOINT}/chat/threads?offset=50`)
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer relay-key')
    expect(headers['x-veodyn-user-token']).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/)
    expect(headers.cookie).toBeUndefined()
  })

  it('refuses a malformed offset without calling out', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await threadsRoute()
    expect((await GET(signedIn({ url: 'http://localhost/api/ai/chat/threads?offset=-1' }))).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a response that is not the canonical shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...thread(), secret: 'x' }, 201)))
    const { POST } = await threadsRoute()
    const response = await POST(signedIn({ method: 'POST' }))
    expect(response.status).toBe(201)
    expect(await response.json()).not.toHaveProperty('secret')
    vi.stubGlobal('fetch', vi.fn(async () => json({ id: 'not-a-uuid' }, 201)))
    const { POST: again } = await threadsRoute()
    expect((await again(signedIn({ method: 'POST' }))).status).toBe(502)
  })

  it.each([
    [404, 404],
    [409, 409],
    [422, 422],
    [500, 502],
  ])('maps an upstream %i to %i without its body', async (upstream, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { message: 'internal detail' } }, upstream)))
    const { POST } = await threadsRoute()
    const response = await POST(signedIn({ method: 'POST' }))
    expect(response.status).toBe(expected)
    expect(JSON.stringify(await response.json())).not.toContain('internal detail')
  })

  it('refuses a bad thread id before calling out', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    mockChatModules()
    const { GET } = await import('@/app/api/ai/chat/threads/[id]/route')
    const response = await GET(signedIn(), { params: Promise.resolve({ id: '../../admin' }) })
    expect(response.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('validates the turn body', async () => {
    const fetchMock = vi.fn(async () => json({ turnId: THREAD, seq: 1 }, 202))
    vi.stubGlobal('fetch', fetchMock)
    mockChatModules()
    const { POST } = await import('@/app/api/ai/chat/threads/[id]/turns/route')
    const params = { params: Promise.resolve({ id: THREAD }) }
    const bad = await POST(signedIn({ method: 'POST', body: JSON.stringify({ text: '' }) }), params)
    expect(bad.status).toBe(400)
    const good = await POST(signedIn({ method: 'POST', body: JSON.stringify({ text: 'hi' }) }), params)
    expect(good.status).toBe(202)
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({
      text: 'hi',
    })
  })

  it('accepts a tool result up to 256 KB and refuses a larger one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ accepted: true }, 202)))
    mockChatModules()
    const { POST } = await import('@/app/api/ai/chat/turns/[id]/tool-results/route')
    const params = { params: Promise.resolve({ id: THREAD }) }
    const row = { text: 'x'.repeat(3_000) }
    const fits = { callId: 'c', result: { ok: true, sample: Array.from({ length: 50 }, () => row) } }
    expect((await POST(signedIn({ method: 'POST', body: JSON.stringify(fits) }), params)).status).toBe(202)
    const big = { callId: 'c', result: { ok: true, sample: [{ text: 'x'.repeat(300_000) }] } }
    expect((await POST(signedIn({ method: 'POST', body: JSON.stringify(big) }), params)).status).toBe(400)
  })

  it('passes a 204 through on delete', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    mockChatModules()
    const { DELETE } = await import('@/app/api/ai/chat/threads/[id]/route')
    expect((await DELETE(signedIn({ method: 'DELETE' }), { params: Promise.resolve({ id: THREAD }) })).status).toBe(
      204
    )
  })

  it('sets the cookie when the relay minted a token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(thread(), 201)))
    const { POST } = await threadsRoute()
    const response = await POST(new Request('http://localhost/api/ai/chat/threads', {
      method: 'POST',
      headers: { cookie: 'session=s' },
    }))
    expect(response.headers.getSetCookie().some((one) => one.startsWith('veodyn_ai='))).toBe(true)
  })
})
