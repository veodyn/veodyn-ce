// @vitest-environment node
//
// The contract that matters here: a tool that fails comes back as a SUCCESSFUL
// JSON-RPC result carrying isError, not as a transport error. MCP works that
// way so the model sees what went wrong and can adjust; a -32603 hides the
// reason and the model just retries the same broken call.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const REDASH = 'http://redash.test'
const CONTEXT = {
  credential: { apiKey: 'abc123', session: null, csrfToken: null },
  server: { name: 'veodyn', version: '1.0.0' },
  clock: { now: () => 0, sleep: async () => {} },
}

async function loadDispatch() {
  vi.resetModules()
  process.env.REDASH_URL = REDASH
  return (await import('@/lib/mcp/dispatch')).dispatch
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function call(name: string, args: Record<string, unknown> = {}) {
  return {
    jsonrpc: '2.0' as const,
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  }
}

/** The text of the single content block a tool result carries. */
function resultText(response: unknown): string {
  const result = (response as { result: { content: { text: string }[] } }).result
  return result.content[0].text
}

function isError(response: unknown): boolean {
  return (response as { result: { isError: boolean } }).result.isError
}

beforeEach(() => {
  process.env.REDASH_URL = REDASH
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.REDASH_URL
})

describe('tools/call', () => {
  it('returns the tool data as JSON text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ count: 0, results: [] }))
    const dispatch = await loadDispatch()

    const response = await dispatch(call('list_queries'), CONTEXT)

    expect(isError(response)).toBe(false)
    expect(JSON.parse(resultText(response))).toEqual({ count: 0, queries: [] })
  })

  it('reports an unknown tool as a tool error, and points at tools/list', async () => {
    const dispatch = await loadDispatch()

    const response = await dispatch(call('drop_everything'), CONTEXT)

    expect(isError(response)).toBe(true)
    expect(resultText(response)).toMatch(/tools\/list/)
  })

  it('explains a credential Redash refused, rather than a bare 403', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 403 }))
    const dispatch = await loadDispatch()

    const response = await dispatch(call('get_query', { query_id: 7 }), CONTEXT)

    expect(isError(response)).toBe(true)
    expect(resultText(response)).toMatch(/API key/)
  })

  it('says an object is simply not there on a 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }))
    const dispatch = await loadDispatch()

    const response = await dispatch(call('get_query', { query_id: 999 }), CONTEXT)

    expect(resultText(response)).toBe('No such object on this instance.')
  })

  it('does not mistake an unrecognised API key for a missing object', async () => {
    // Redash answers a bad key with 404 and this body rather than 401, so that
    // an unauthenticated caller cannot probe for what exists. Reporting it as
    // "no such object" sent someone with a typo hunting for a query that was
    // sitting right there. Verified against a live instance.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: "Couldn't find resource. Please login and try again." }), {
        status: 404,
      })
    )
    const dispatch = await loadDispatch()

    const response = await dispatch(call('list_queries'), CONTEXT)

    expect(isError(response)).toBe(true)
    expect(resultText(response)).toMatch(/did not recognise this credential/)
  })

  it('names a bad argument so the model can fix its own call', async () => {
    const dispatch = await loadDispatch()

    const response = await dispatch(call('get_query', { query_id: 'seven' }), CONTEXT)

    expect(isError(response)).toBe(true)
    expect(resultText(response)).toMatch(/query_id must be an integer/)
  })

  it('treats missing arguments as empty rather than crashing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ count: 0, results: [] }))
    const dispatch = await loadDispatch()

    const response = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_queries' } },
      CONTEXT
    )

    expect(isError(response)).toBe(false)
  })
})

describe('lifecycle methods', () => {
  it('answers ping with an empty result', async () => {
    const dispatch = await loadDispatch()

    expect(await dispatch({ jsonrpc: '2.0', id: 9, method: 'ping' }, CONTEXT)).toEqual({
      jsonrpc: '2.0',
      id: 9,
      result: {},
    })
  })

  it('says nothing back to a notification', async () => {
    const dispatch = await loadDispatch()

    expect(
      await dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' }, CONTEXT)
    ).toBeNull()
    expect(await dispatch({ jsonrpc: '2.0', method: 'ping' }, CONTEXT)).toBeNull()
  })

  it('does not answer an unknown notification either', async () => {
    const dispatch = await loadDispatch()

    expect(await dispatch({ jsonrpc: '2.0', method: 'notifications/whatever' }, CONTEXT)).toBeNull()
  })
})
