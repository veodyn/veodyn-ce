import { afterEach, describe, expect, it, vi } from 'vitest'
import { THREAD, mockChatModules, signedIn, unmockChatModules } from './relay-test-harness'

afterEach(unmockChatModules)

function sse(...chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  )
}

const STARTED = `id: 1-0\nevent: turn_started\ndata: {"turnId":"${THREAD}","seq":1}\n\n`
const DELTA = 'id: 1-1\nevent: text_delta\ndata: {"text":"Hello"}\n\n'
const DONE = 'id: 1-2\nevent: turn_done\ndata: {"stopReason":"end_turn","usage":{"input_tokens":3}}\n\n'

async function stream(upstream: Response, headers: Record<string, string> = {}) {
  const fetchMock = vi.fn(async () => upstream)
  vi.stubGlobal('fetch', fetchMock)
  mockChatModules()
  const { GET } = await import('@/app/api/ai/chat/turns/[id]/stream/route')
  const response = await GET(signedIn({ headers }), { params: Promise.resolve({ id: THREAD }) })
  return { response, fetchMock }
}

describe('chat stream relay', () => {
  it('passes valid frames through, split across chunks, and stops at the terminal frame', async () => {
    const { response, fetchMock } = await stream(sse(STARTED.slice(0, 10), STARTED.slice(10) + DELTA, DONE, DELTA))
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(response.headers.get('x-accel-buffering')).toBe('no')
    expect(await response.text()).toBe(STARTED + DELTA + DONE)
    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>
    expect(headers.accept).toBe('text/event-stream')
    expect(headers.cookie).toBeUndefined()
  })

  it('forwards keep-alives and a valid last event id', async () => {
    const { response, fetchMock } = await stream(sse(': keep-alive\n\n', DONE), { 'last-event-id': '1-1' })
    expect(await response.text()).toBe(': keep-alive\n\n' + DONE)
    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>
    expect(headers['last-event-id']).toBe('1-1')
  })

  it('drops a malformed last event id', async () => {
    const { fetchMock } = await stream(sse(DONE), { 'last-event-id': '0-0; drop' })
    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>
    expect(headers['last-event-id']).toBeUndefined()
  })

  it.each([
    ['an unknown event', 'event: shell\ndata: {}\n\n'],
    ['a field outside the schema', 'event: text_delta\ndata: {"text":"a","extra":1}\n\n'],
    ['data that is not JSON', 'event: text_delta\ndata: {nope\n\n'],
    ['an oversized frame', `event: text_delta\ndata: {"text":"${'x'.repeat(70_000)}"}\n\n`],
  ])('ends with a synthesized error on %s and forwards nothing after it', async (_label, bad) => {
    const { response } = await stream(sse(STARTED, bad, DELTA, DONE))
    const text = await response.text()
    expect(text.startsWith(STARTED)).toBe(true)
    expect(text).toContain('event: error')
    expect(text).toContain('E_AI_006')
    expect(text).not.toContain('Hello')
    expect(text).not.toContain('turn_done')
  })

  it('ends with an error when the stream grows past its cap', async () => {
    const delta = `event: text_delta\ndata: {"text":"${'y'.repeat(19_000)}"}\n\n`
    const { response } = await stream(sse(...Array.from({ length: 230 }, () => delta), DONE))
    const text = await response.text()
    expect(text.endsWith('\n\n')).toBe(true)
    expect(text).toContain('E_AI_006')
    expect(text).not.toContain('turn_done')
  })

  it('maps an upstream 404 to 404 and anything else to 502', async () => {
    expect((await stream(new Response('{}', { status: 404 }))).response.status).toBe(404)
    expect((await stream(new Response('{}', { status: 500 }))).response.status).toBe(502)
  })
})
