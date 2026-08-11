// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'
import { authedRequest, loadRoute, validPayload } from './generate-sql-test-harness'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

// ── Finding 2: send only the server key to the provider ──────────────────────
describe('POST /api/ai/generate-sql: provider credentials', () => {
  it('sends only the server key, never the caller cookie or authorization', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sql: 'SELECT 1', rationale: 'provider result' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    const { POST } = await loadRoute({
      enabled: true,
      endpoint: 'http://ai.test///',
      key: 'server-secret-key',
      realMode: true,
    })
    const incoming = authedRequest(validPayload, {
      authorization: 'Bearer caller-token',
      cookie: 'session=abc; csrf_token=xyz; redash_api_key=secret',
    })

    const response = await POST(incoming)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ sql: 'SELECT 1', rationale: 'provider result' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('http://ai.test/generate-sql')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers).toEqual({
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: 'Bearer server-secret-key',
    })
    // Nothing from the browser's credential set reaches the AI endpoint.
    expect(headers).not.toHaveProperty('cookie')
    expect(JSON.stringify(headers)).not.toContain('caller-token')
    expect(JSON.stringify(headers)).not.toContain('redash_api_key')
    expect((init as RequestInit).body).toBe(JSON.stringify(validPayload))
  })

  it('does not forward the caller authorization when no provider key is configured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ sql: 'SELECT 1', rationale: 'provider result' })
    )
    const { POST } = await loadRoute({
      enabled: true,
      endpoint: 'http://ai.test',
      key: '',
      realMode: true,
    })

    const response = await POST(
      authedRequest(validPayload, { authorization: 'Bearer caller-token' })
    )

    expect(response.status).toBe(200)
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers).not.toHaveProperty('authorization')
    expect(headers).not.toHaveProperty('cookie')
    expect(JSON.stringify(headers)).not.toContain('caller-token')
  })
})

// ── Finding 3: validate the provider response, never echo it verbatim ────────
describe('POST /api/ai/generate-sql: provider response handling', () => {
  it('discards a provider error body and returns a generic classified failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'rate limited',
          authorization: 'Bearer provider-secret',
          endpoint: 'http://internal-ai',
        }),
        { status: 429, headers: { 'content-type': 'application/problem+json' } }
      )
    )
    const { POST } = await loadRoute({
      enabled: true,
      endpoint: 'http://ai.test',
      realMode: true,
    })

    const response = await POST(authedRequest())
    const text = await response.text()

    // The provider status and body are NOT passed through.
    expect(response.status).toBe(502)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(text).not.toContain('provider-secret')
    expect(text).not.toContain('internal-ai')
    expect(JSON.parse(text)).toMatchObject({ id: 'E_AI_001' })
  })

  it('rejects a 200 provider response that is missing the SQL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    const { POST } = await loadRoute({
      enabled: true,
      endpoint: 'http://ai.test',
      realMode: true,
    })

    const response = await POST(authedRequest())
    const body = await response.json()

    // A 200 {} must never reach the browser as an undefined SQL draft.
    expect(response.status).toBe(502)
    expect(body).toMatchObject({ id: 'E_AI_001' })
    expect(body).not.toHaveProperty('sql')
  })

  it('returns only the canonical sql and rationale from a provider success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          sql: 'SELECT 1',
          rationale: 'ok',
          authorization: 'Bearer provider-secret',
          usage: { tokens: 42 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    const { POST } = await loadRoute({
      enabled: true,
      endpoint: 'http://ai.test',
      realMode: true,
    })

    const response = await POST(authedRequest())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ sql: 'SELECT 1', rationale: 'ok' })
  })

  it('returns a generic 503 without exposing endpoint or key', async () => {
    const { POST } = await loadRoute({
      enabled: true,
      endpoint: null,
      key: 'private-provider-key',
      realMode: true,
    })

    const response = await POST(authedRequest())
    const text = await response.text()

    expect(response.status).toBe(503)
    expect(text).not.toContain('endpoint')
    expect(text).not.toContain('private-provider-key')
  })

  it('returns a generic 502 when the provider is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('http://private-ai.test failed with private-provider-key')
    )
    const { POST } = await loadRoute({
      enabled: true,
      endpoint: 'http://private-ai.test',
      key: 'private-provider-key',
      realMode: true,
    })

    const response = await POST(authedRequest())
    const text = await response.text()

    expect(response.status).toBe(502)
    expect(text).not.toContain('http://private-ai.test')
    expect(text).not.toContain('private-provider-key')
  })
})
