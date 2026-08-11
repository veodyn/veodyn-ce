// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_MESSAGE_CHARS, MAX_TRANSCRIPT_MESSAGES, MAX_USER_TURNS } from '@/types/ai-create'
import type { CreateKind } from '@/types/ai-create'
import {
  KINDS,
  authedRequest,
  fromProvider,
  jsonResponse,
  loadRoute,
  readyTurn,
  request,
  transcript,
  validPayload,
} from './converse-test-harness'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('POST /api/ai/converse: gate and caller auth', () => {
  it('refuses before inspecting configuration details when ai.enabled is false', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const first = await loadRoute({
      enabled: false,
      endpoint: 'http://private-ai-one.test',
      key: 'private-key-one',
      realMode: true,
    })
    const firstResponse = await first.POST(request('{malformed'))
    const second = await loadRoute({ enabled: false, endpoint: null, key: '', realMode: false })
    const secondResponse = await second.POST(request({ unexpected: true }))

    expect(firstResponse.status).toBe(403)
    expect(secondResponse.status).toBe(403)
    const firstText = await firstResponse.text()
    expect(firstText).toBe(await secondResponse.text())
    expect(JSON.parse(firstText)).toMatchObject({ id: 'E_AUTH_002' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated caller before running the mock', async () => {
    const { POST } = await loadRoute({ enabled: true, endpoint: 'http://ai.test', realMode: false })

    const response = await POST(request(validPayload)) // no session cookie
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toMatchObject({ id: 'E_AUTH_001' })
    // The mock never ran: no reply and no proposal reached an anonymous caller.
    expect(body).not.toHaveProperty('reply')
    expect(body).not.toHaveProperty('proposal')
  })

  it('refuses an unauthenticated caller before contacting the provider', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { POST } = await loadRoute({ enabled: true, endpoint: 'http://ai.test', realMode: true })

    const response = await POST(request(validPayload)) // no session cookie

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ id: 'E_AUTH_001' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses a caller whose session does not validate against the backend', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { POST } = await loadRoute({
      enabled: true,
      endpoint: 'http://ai.test',
      realMode: true,
      session: 'invalid',
    })

    const response = await POST(authedRequest())

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ id: 'E_AUTH_001' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('POST /api/ai/converse: request validation', () => {
  const oversizedMessage = { role: 'user', content: 'x'.repeat(MAX_MESSAGE_CHARS + 1) }

  it.each([
    ['malformed JSON', '{malformed'],
    ['a missing kind', { messages: transcript(1) }],
    ['a kind outside the five', { kind: 'alert', messages: transcript(1) }],
    ['an unknown top-level field', { ...validPayload, datasets: [] }],
    ['an empty transcript', { kind: 'query', messages: [] }],
    ['an unknown message role', { kind: 'query', messages: [{ role: 'system', content: 'hi' }] }],
    ['an empty message', { kind: 'query', messages: [{ role: 'user', content: '' }] }],
    ['a message over the character cap', { kind: 'query', messages: [oversizedMessage] }],
    [
      'more messages than the transcript cap',
      {
        kind: 'query',
        messages: Array.from({ length: MAX_TRANSCRIPT_MESSAGES + 1 }, () => ({
          role: 'user' as const,
          content: 'hi',
        })),
      },
    ],
    ['more user turns than the turn cap', { kind: 'query', messages: transcript(MAX_USER_TURNS + 1) }],
  ])('returns 400 for %s', async (_label, payload) => {
    const { POST } = await loadRoute({ enabled: true, endpoint: 'http://ai.test', realMode: false })

    const response = await POST(authedRequest(payload))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ id: 'E_AI_002' })
  })

  it('accepts a transcript sitting exactly on the turn cap', async () => {
    const { POST } = await loadRoute({ enabled: true, endpoint: 'http://ai.test', realMode: false })

    // The control for the case above: without it, a schema that refused every
    // multi-turn transcript would pass the cap test.
    const messages = transcript(MAX_USER_TURNS)
    expect(messages.filter((m) => m.role === 'user')).toHaveLength(MAX_USER_TURNS)
    const response = await POST(authedRequest({ kind: 'query', messages }))

    expect(response.status).toBe(200)
  })

  it('carries the focus table the previous turn named up to the provider', async () => {
    // The endpoint is stateless, so this round trip is the only thing that keeps
    // two turns talking about the same table. Left out of the request schema it
    // is not a dropped key, it is a 400 on every turn after the first.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(readyTurn('query')))
    const { POST } = await loadRoute({ enabled: true, endpoint: 'http://ai.test', realMode: true })

    const response = await POST(authedRequest({ ...validPayload, focusTable: 'analytics.rail_taps' }))

    expect(response.status).toBe(200)
    const sent = JSON.parse(fetchSpy.mock.calls.at(-1)?.[1]?.body as string)
    expect(sent.focusTable).toBe('analytics.rail_taps')
  })

  it('returns 400 for a body above the request limit', async () => {
    const { POST } = await loadRoute({ enabled: true, endpoint: 'http://ai.test', realMode: false })
    // Every per-field cap is satisfied here (25 messages, 12 of them the user's,
    // each exactly at the character cap). Only the byte cap refuses it, so
    // dropping the byte cap turns this 400 into a 200.
    const messages = Array.from({ length: MAX_TRANSCRIPT_MESSAGES }, (_, i) => ({
      role: i % 2 === 0 ? 'assistant' : 'user',
      content: 'x'.repeat(MAX_MESSAGE_CHARS),
    }))

    const response = await POST(authedRequest({ kind: 'query', messages }))

    expect(messages.filter((m) => m.role === 'user')).toHaveLength(MAX_USER_TURNS)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ id: 'E_AI_002' })
  })
})

describe('POST /api/ai/converse: demo mode', () => {
  it('asks a follow-up on the first turn and proposes on the next, deterministically', async () => {
    const { POST } = await loadRoute({ enabled: true, endpoint: 'http://ai.test', realMode: false })

    const first = await (await POST(authedRequest())).json()
    const second = await (
      await POST(authedRequest({ kind: 'query', messages: transcript(2) }))
    ).json()
    const repeat = await (await POST(authedRequest())).json()

    expect(first).toEqual(repeat)
    expect(first).toMatchObject({ ready: false, proposal: null })
    expect(first.reply.length).toBeGreaterThan(0)
    expect(second).toMatchObject({ ready: true, proposal: { kind: 'query' } })
  })
})

describe('POST /api/ai/converse: provider response handling', () => {
  it.each(KINDS)('relays a valid ready turn for kind %s unchanged', async (kind: CreateKind) => {
    const success = readyTurn(kind)

    const response = await fromProvider(success)

    // Also the proof that what mockConverse produces satisfies this route's own
    // response schema: the two ends of the contract cannot drift apart.
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(success)
  })

  it('refuses an empty 200 rather than relaying it as a turn', async () => {
    const response = await fromProvider({})

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ id: 'E_AI_001' })
  })

  it('discards the provider error body behind a classified failure', async () => {
    const response = await fromProvider(
      { error: 'rate limited', authorization: 'Bearer provider-secret' },
      500
    )
    const text = await response.text()

    expect(response.status).toBe(502)
    expect(text).not.toContain('provider-secret')
    expect(JSON.parse(text)).toMatchObject({ id: 'E_AI_001' })
  })

  // Both directions of ready === (proposal !== null). Each starts from a turn
  // the route accepts, so the only thing under test is the invariant.
  it.each([
    ['a ready turn that carries no proposal', { ...readyTurn('query'), proposal: null }],
    ['a proposal on a turn that is not ready', { ...readyTurn('query'), ready: false }],
  ])('refuses %s', async (_label, body) => {
    const response = await fromProvider(body)

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ id: 'E_AI_001' })
  })

  it.each([
    ['an unknown proposal kind', { kind: 'alert', name: 'x' }],
    ['a smuggled extra field', { ...readyTurn('query').proposal, usage: { tokens: 42 } }],
    ['a proposal missing its SQL', { ...readyTurn('query').proposal, sql: undefined }],
    [
      'a dashboard widget with an unusable query id',
      {
        ...readyTurn('dashboard').proposal,
        widgets: [{ queryId: 0, visualizationId: 1, title: 'Widget' }],
      },
    ],
  ])('refuses %s', async (_label, proposal) => {
    const response = await fromProvider({ ...readyTurn('query'), proposal })

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ id: 'E_AI_001' })
  })

  it('accepts the options the service authored, and hands them on whole', async () => {
    const authored = { columnMapping: { bucket: 'x', bikes: 'y' }, legend: { enabled: false } }
    const proposal = { ...readyTurn('query').proposal, vizOptions: authored }

    const response = await fromProvider({ ...readyTurn('query'), proposal })

    // Relayed rather than merely tolerated: a schema that accepted the key and
    // stripped its contents would leave the card drawing an unmapped chart.
    expect(response.status).toBe(200)
    expect((await response.json()).proposal.vizOptions).toEqual(authored)
  })

  it('still refuses a key nobody declared', async () => {
    // The tripwire that makes a drift between schemas/ai.py and this file
    // surface as "AI is broken" rather than as a tolerated difference. Adding
    // vizOptions must not turn it off: the record is one declared key, not a
    // licence for arbitrary JSON beside it.
    const proposal = { ...readyTurn('query').proposal, vizOptions: {}, surprise: 'hello' }

    const response = await fromProvider({ ...readyTurn('query'), proposal })

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ id: 'E_AI_001' })
  })

  it('refuses more suggested answers than the chip row offers', async () => {
    const response = await fromProvider({
      reply: 'pick one',
      suggestedAnswers: ['a', 'b', 'c', 'd', 'e'],
      ready: false,
      proposal: null,
    })

    expect(response.status).toBe(502)
  })
})
