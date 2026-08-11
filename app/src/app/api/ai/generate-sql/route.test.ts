// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SESSION,
  authedRequest,
  loadRoute,
  request,
  sessionValidationSignals,
  validPayload,
} from './generate-sql-test-harness'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('POST /api/ai/generate-sql: gate and caller auth', () => {
  it('refuses before inspecting configuration details when ai.enabled is false', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const first = await loadRoute({
      enabled: false,
      endpoint: 'http://private-ai-one.test',
      key: 'private-key-one',
      realMode: true,
    })
    const firstResponse = await first.POST(request('{malformed'))

    const second = await loadRoute({
      enabled: false,
      endpoint: null,
      key: '',
      realMode: false,
    })
    const secondResponse = await second.POST(request({ unexpected: true }))

    expect(firstResponse.status).toBe(403)
    expect(secondResponse.status).toBe(403)
    const firstText = await firstResponse.text()
    expect(firstText).toBe(await secondResponse.text())
    expect(JSON.parse(firstText)).toMatchObject({ id: 'E_AUTH_002' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // ── Finding 1: authenticate the caller before doing any work ───────────────
  it('refuses an unauthenticated caller before running the mock', async () => {
    const { POST } = await loadRoute({
      enabled: true,
      endpoint: 'http://ai.test',
      realMode: false,
    })

    const response = await POST(request(validPayload)) // no session cookie
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toMatchObject({ id: 'E_AUTH_001' })
    // The mock never ran: no SQL leaked to an anonymous caller.
    expect(body).not.toHaveProperty('sql')
  })

  it('refuses an unauthenticated caller before contacting the provider', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { POST } = await loadRoute({
      enabled: true,
      endpoint: 'http://ai.test',
      key: 'server-secret-key',
      realMode: true,
    })

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

    const response = await POST(authedRequest()) // cookie present but not valid

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ id: 'E_AUTH_001' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('threads the request abort signal into the session validation', async () => {
    sessionValidationSignals.length = 0
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ sql: 'SELECT 1', rationale: 'ok' })
    )
    const { POST } = await loadRoute({
      enabled: true,
      endpoint: 'http://ai.test',
      realMode: true,
    })
    const incoming = new Request('http://localhost/api/ai/generate-sql', {
      method: 'POST',
      headers: { cookie: SESSION },
      body: JSON.stringify(validPayload),
    })

    await POST(incoming)

    // A cancelled AI request must be able to abort the upstream session check,
    // so the route hands requireSession the request's own signal, not nothing.
    expect(sessionValidationSignals.at(-1)).toBe(incoming.signal)
  })

  it('returns deterministic mock SQL for an authenticated caller in demo mode', async () => {
    const { POST } = await loadRoute({
      enabled: true,
      endpoint: 'http://private-ai.test',
      realMode: false,
    })

    const first = await POST(authedRequest())
    const second = await POST(authedRequest())

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await first.json()).toEqual(await second.json())
    const response = await POST(authedRequest())
    expect((await response.json()).sql).toContain('FROM t')
  })
})

describe('POST /api/ai/generate-sql: request validation', () => {
  it.each([
    ['malformed JSON', '{malformed'],
    ['missing dataset', { prompt: 'show boardings' }],
    [
      'wrong column shape',
      {
        prompt: 'show boardings',
        dataset: { table: 't', columns: 'boardings' },
      },
    ],
  ])('returns 400 for %s', async (_label, payload) => {
    const { POST } = await loadRoute({
      enabled: true,
      endpoint: 'http://ai.test',
      realMode: false,
    })

    const response = await POST(request(payload))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.any(String) })
  })

  it('returns 400 for a body above the request limit', async () => {
    const { POST } = await loadRoute({
      enabled: true,
      endpoint: 'http://ai.test',
      realMode: false,
    })
    const payload = { ...validPayload, prompt: 'x'.repeat(70_000) }

    const response = await POST(request(payload))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.any(String) })
  })

  it('maps an unsafe mock grounding AppError to 400', async () => {
    const { POST } = await loadRoute({
      enabled: true,
      endpoint: 'http://ai.test',
      realMode: false,
    })

    const response = await POST(
      authedRequest({
        ...validPayload,
        dataset: { ...validPayload.dataset, table: 't; DROP TABLE users' },
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ id: 'E_AI_002' })
  })
})
