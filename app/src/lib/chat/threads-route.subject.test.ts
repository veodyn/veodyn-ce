import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENDPOINT, THREAD, json, mockChatModules, signedIn, thread, unmockChatModules } from './relay-test-harness'

afterEach(unmockChatModules)

async function create(body: unknown, upstream: unknown = thread()) {
  mockChatModules()
  const fetchMock = vi.fn<typeof fetch>(async () => json(upstream, 201))
  vi.stubGlobal('fetch', fetchMock)
  const { POST } = await import('@/app/api/ai/chat/threads/route')
  const response = await POST(signedIn({ method: 'POST', body: JSON.stringify(body) }))
  return { response, fetchMock }
}

function forwarded(fetchMock: { mock: { calls: unknown[][] } }): unknown {
  return JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
}

describe('thread creation with a subject', () => {
  it('forwards the subject to the sidecar', async () => {
    const subject = { kind: 'visualization', queryId: 7, visualizationId: 12 }
    const { response, fetchMock } = await create({ subject })
    expect(response.status).toBe(201)
    expect(fetchMock.mock.calls[0][0]).toBe(`${ENDPOINT}/chat/threads`)
    expect(forwarded(fetchMock)).toEqual({ subject })
  })

  it('forwards an empty body for a thread without a subject', async () => {
    const { response, fetchMock } = await create({})
    expect(response.status).toBe(201)
    expect(forwarded(fetchMock)).toEqual({})
  })

  it('treats a request with no body as a thread without a subject', async () => {
    mockChatModules()
    const fetchMock = vi.fn<typeof fetch>(async () => json(thread(), 201))
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await import('@/app/api/ai/chat/threads/route')
    const response = await POST(signedIn({ method: 'POST' }))
    expect(response.status).toBe(201)
    expect(forwarded(fetchMock)).toEqual({})
  })

  it('refuses an unauthenticated oversized body at the gate without reading it', async () => {
    mockChatModules()
    vi.stubGlobal('fetch', vi.fn())
    let pulls = 0
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1
          controller.enqueue(new Uint8Array(1024 * 1024))
        },
      },
      { highWaterMark: 0 }
    )
    const { POST } = await import('@/app/api/ai/chat/threads/route')
    const response = await POST(
      new Request('http://localhost/api/ai/chat/threads', { method: 'POST', body, duplex: 'half' } as RequestInit)
    )
    expect(response.status).toBe(401)
    expect(pulls).toBe(0)
  })

  it.each([
    ['an unknown key', { subject: { kind: 'query', queryId: 7, extra: 1 } }],
    ['a kind missing its field', { subject: { kind: 'visualization', queryId: 7 } }],
    ['an unknown kind', { subject: { kind: 'report', queryId: 7 } }],
    ['a stray top-level key', { subject: { kind: 'query', queryId: 7 }, title: 'x' }],
  ])('refuses %s without calling the sidecar', async (_label, body) => {
    const { response, fetchMock } = await create(body)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes the subject back on the thread it returns', async () => {
    const subject = { kind: 'dashboard', dashboardId: 4 }
    const { response } = await create({ subject }, thread({ subject }))
    expect((await response.json()).subject).toEqual(subject)
  })
})

describe('thread subject read', () => {
  it('relays the sidecar answer', async () => {
    mockChatModules()
    const subject = { kind: 'dataset', datasetId: 'gtfs_stops' }
    const fetchMock = vi.fn<typeof fetch>(async () => json({ subject }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('@/app/api/ai/chat/threads/[id]/subject/route')
    const response = await GET(signedIn(), { params: Promise.resolve({ id: THREAD }) })
    expect(fetchMock.mock.calls[0][0]).toBe(`${ENDPOINT}/chat/threads/${THREAD}/subject`)
    expect(await response.json()).toEqual({ subject })
  })

  it('refuses a malformed thread id', async () => {
    mockChatModules()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('@/app/api/ai/chat/threads/[id]/subject/route')
    const response = await GET(signedIn(), { params: Promise.resolve({ id: 'nope' }) })
    expect(response.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
