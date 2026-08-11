// @vitest-environment node
//
// Connect > MCP has always documented this URL and it returned 404, so the page
// handed out a copyable client config for a server that did not exist.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const REDASH = 'http://redash.test'

async function loadRoute(redashUrl?: string) {
  vi.resetModules()
  if (redashUrl) process.env.REDASH_URL = redashUrl
  else delete process.env.REDASH_URL
  return import('./route')
}

function rpc(body: unknown, headers: Record<string, string> = { authorization: 'Key abc123' }) {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.REDASH_URL
})

describe('when no analytics backend is configured', () => {
  it('says so plainly rather than 404ing like it used to', async () => {
    const { POST } = await loadRoute(undefined)

    const res = await POST(rpc({ jsonrpc: '2.0', id: 1, method: 'initialize' }))

    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/REDASH_URL not configured/)
  })

  it('answers a GET the same way, so a browser probe is not misleading', async () => {
    const { GET } = await loadRoute(undefined)
    expect(GET().status).toBe(503)
  })
})

describe('authentication', () => {
  it('refuses a request that presents no credential at all', async () => {
    const { POST } = await loadRoute(REDASH)

    const res = await POST(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {}))

    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe('Key')
  })

  it('accepts a session cookie, which is how a browser on this origin arrives', async () => {
    const { POST } = await loadRoute(REDASH)

    const res = await POST(
      rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { cookie: 'session=abc' })
    )

    expect(res.status).toBe(200)
  })

  it('refuses a cookie header that carries no credential', async () => {
    // Any non-empty Cookie header used to count, so `Cookie: theme=dark` got an
    // anonymous caller past the gate and had the endpoint call Redash for them.
    const { POST } = await loadRoute(REDASH)

    const res = await POST(
      rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { cookie: 'theme=dark' })
    )

    expect(res.status).toBe(401)
  })

  it('forwards the API key and NOT the cookie when both arrive', async () => {
    // One credential establishes identity. Sending both lets whichever Redash
    // resolves first decide the permissions, which is how a caller reads a
    // query their own identity may not run.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ count: 0, results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    const { POST } = await loadRoute(REDASH)

    await POST(
      rpc(
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_queries' } },
        { authorization: 'Key secret-key', cookie: 'session=someone-else' }
      )
    )

    const headers = new Headers(fetchSpy.mock.calls[0][1]?.headers as HeadersInit)
    expect(headers.get('Authorization')).toBe('Key secret-key')
    expect(headers.get('Cookie')).toBeNull()
  })

  it('refuses a batch large enough to drive the endpoint as a work queue', async () => {
    const { POST } = await loadRoute(REDASH)

    const res = await POST(
      rpc(
        Array.from({ length: 1000 }, (_, i) => ({
          jsonrpc: '2.0',
          id: i,
          method: 'tools/call',
          params: { name: 'list_queries' },
        }))
      )
    )

    expect(res.status).toBe(413)
    expect((await res.json()).error.message).toMatch(/exceeds the limit/)
  })

  it('forwards the cookie and no Authorization when only a cookie arrives', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ count: 0, results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    const { POST } = await loadRoute(REDASH)

    await POST(
      rpc(
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_queries' } },
        { cookie: 'session=mine' }
      )
    )

    const headers = new Headers(fetchSpy.mock.calls[0][1]?.headers as HeadersInit)
    expect(headers.get('Cookie')).toBe('session=mine')
    expect(headers.get('Authorization')).toBeNull()
  })
})

describe('the JSON-RPC envelope', () => {
  beforeEach(async () => {
    await loadRoute(REDASH)
  })

  it('handshakes', async () => {
    const { POST } = await loadRoute(REDASH)

    const res = await POST(
      rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
    )
    const body = await res.json()

    expect(body.id).toBe(1)
    expect(body.result.protocolVersion).toBe('2025-06-18')
    expect(body.result.serverInfo.name).toBe('veodyn')
  })

  it('lists the tools it actually implements', async () => {
    const { POST } = await loadRoute(REDASH)

    const body = await (await POST(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))).json()

    expect(body.result.tools.map((t: { name: string }) => t.name)).toEqual([
      'list_queries',
      'get_query',
      'run_query',
      'list_dashboards',
      'get_dashboard',
    ])
  })

  it('answers a notification with 202 and no body', async () => {
    const { POST } = await loadRoute(REDASH)

    const res = await POST(rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }))

    expect(res.status).toBe(202)
    expect(await res.text()).toBe('')
  })

  it.each(['tools/list', 'initialize', 'ping'])(
    'says nothing back to %s sent without an id, which JSON-RPC forbids answering',
    async (method) => {
      // These are request-shaped methods, but a message with no id is a
      // notification whatever its method, and replying with `id: null` is a
      // protocol violation a strict client rejects.
      const { POST } = await loadRoute(REDASH)

      const res = await POST(rpc({ jsonrpc: '2.0', method }))

      expect(res.status).toBe(202)
      expect(await res.text()).toBe('')
    }
  )

  it('refuses an unknown method', async () => {
    const { POST } = await loadRoute(REDASH)

    const body = await (await POST(rpc({ jsonrpc: '2.0', id: 3, method: 'resources/list' }))).json()

    expect(body.error.code).toBe(-32601)
  })

  it('reports a body that is not JSON', async () => {
    const { POST } = await loadRoute(REDASH)

    const res = await POST(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Key abc' },
        body: 'not json',
      })
    )

    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe(-32700)
  })

  it('answers a batch in kind, and drops the notifications from it', async () => {
    const { POST } = await loadRoute(REDASH)

    const body = await (
      await POST(
        rpc([
          { jsonrpc: '2.0', id: 1, method: 'ping' },
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        ])
      )
    ).json()

    expect(Array.isArray(body)).toBe(true)
    expect(body.map((r: { id: number }) => r.id)).toEqual([1, 2])
  })

  it('refuses a message that is not a JSON-RPC request object', async () => {
    const { POST } = await loadRoute(REDASH)

    const body = await (await POST(rpc({ hello: 'there' }))).json()

    expect(body.error.code).toBe(-32600)
  })

  it('tells a GET to POST instead, rather than opening a stream it never uses', async () => {
    const { GET } = await loadRoute(REDASH)

    const res = GET()

    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('POST')
  })
})
