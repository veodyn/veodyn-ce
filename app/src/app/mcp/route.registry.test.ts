// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { verifyAiToken } from '@/lib/ai-token'
import {
  fakeBackend,
  jsonResponse,
  loadWithRelay,
  REDASH,
  SECRET,
  unloadRelay,
  type RelaySettings,
} from '@/lib/mcp/mcp-registry-fixtures'

function rpc(body: unknown, headers: Record<string, string> = { authorization: 'Key abc123' }) {
  return new Request('https://app.example/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list' }

function loadRoute(settings: RelaySettings = {}) {
  return loadWithRelay(() => import('./route'), settings)
}

afterEach(unloadRelay)

describe('availability', () => {
  it('answers 503 naming the relay key when it is unset', async () => {
    fakeBackend()
    const { POST } = await loadRoute({ key: '' })

    const res = await POST(rpc(LIST))

    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).toMatch(/VEODYN_AI__KEY/)
  })

  it('answers 503 naming the token secret when it is unset', async () => {
    fakeBackend()
    const { POST } = await loadRoute({ secret: '' })

    const res = await POST(rpc(LIST))

    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).toMatch(/VEODYN_AI__TOKEN_SECRET/)
  })

  it('answers 503 naming the endpoint when the sidecar is not configured', async () => {
    fakeBackend()
    const { POST } = await loadRoute({ endpoint: null })

    const res = await POST(rpc(LIST))

    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).toMatch(/ai\.endpoint/)
  })
})

describe('one identity per request', () => {
  it('uses the key for identity, context, transport and token when cookies for another user arrive too', async () => {
    const backend = fakeBackend({
      userId: 7,
      sidecar: (path) =>
        path === '/chat/mcp/calls'
          ? jsonResponse({ kind: 'client_call', callId: 'c1', tool: 'describe_data_source', args: { dataSourceId: 3 } })
          : jsonResponse({ kind: 'done', content: 'Described.', isError: false, draft: null }),
      node: (url) => {
        if (url === `${REDASH}/api/data_sources`) {
          return jsonResponse([{ id: 3, name: 'W', type: 'pg', syntax: 'sql', view_only: false }])
        }
        if (url === `${REDASH}/api/data_sources/3`) {
          return jsonResponse({ id: 3, name: 'W', type: 'pg', syntax: 'sql', view_only: false })
        }
        if (url === `${REDASH}/api/data_sources/3/schema`) return jsonResponse({ schema: [] })
        return jsonResponse({}, 404)
      },
    })
    const { POST } = await loadRoute()

    const res = await POST(
      rpc(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'describe_data_source', arguments: { dataSourceId: 3 } },
        },
        { authorization: 'Key abc123', cookie: 'session=someone-else; veodyn_ai=other-users-token' }
      )
    )

    expect(res.status).toBe(200)
    expect(backend.nodeCalls.length).toBeGreaterThan(1)
    for (const one of backend.nodeCalls) {
      const headers = new Headers(one.init?.headers as HeadersInit)
      expect(headers.get('authorization')).toBe('Key abc123')
      expect(headers.get('cookie')).toBeNull()
    }
    expect(backend.sidecarCalls.length).toBeGreaterThan(0)
    for (const one of backend.sidecarCalls) {
      expect(verifyAiToken(one.headers.get('x-veodyn-user-token') ?? '', SECRET)?.subject).toBe(7)
    }
  })

  it('resolves identity once for a batch of calls', async () => {
    const backend = fakeBackend({
      sidecar: () => jsonResponse({ kind: 'done', content: 'ok', isError: false, draft: null }),
    })
    const { POST } = await loadRoute()
    const call = (id: number) => ({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: 'search_library', arguments: {} },
    })

    await POST(rpc([call(1), call(2), call(3)]))

    expect(backend.nodeCalls.filter((one) => one.url === `${REDASH}/api/session`)).toHaveLength(1)
  })
})
