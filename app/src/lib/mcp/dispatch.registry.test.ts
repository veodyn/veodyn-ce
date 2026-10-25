// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { installsNoFeaturePackages } from '@/features'
import { verifyAiToken } from '@/lib/ai-token'
import {
  fakeBackend,
  jsonResponse,
  KEY_CREDENTIAL,
  loadWithRelay,
  REDASH,
  request,
  SECRET,
  unloadRelay,
  type RelaySettings,
} from './mcp-registry-fixtures'

const SERVER = { name: 'veodyn', version: '1.0.0' }

const REGISTRY_TOOLS = [
  {
    name: 'run_query',
    description: 'Run SQL.',
    inputSchema: {
      type: 'object',
      properties: { dataSourceId: { type: 'number' }, sql: { type: 'string' } },
      required: ['dataSourceId', 'sql'],
    },
  },
  { name: 'list_data_sources', description: 'List sources.', inputSchema: { type: 'object', properties: {} } },
  { name: 'open_query', description: 'Open a query.', inputSchema: { type: 'object', properties: {} } },
  { name: 'search_library', description: 'Search.', inputSchema: { type: 'object', properties: {} } },
  { name: 'open_dashboard', description: 'Open a dashboard.', inputSchema: { type: 'object', properties: {} } },
]

async function loadModules(settings: RelaySettings = {}) {
  return loadWithRelay(async () => {
    const [{ dispatch }, { createMcpSession }] = await Promise.all([import('./dispatch'), import('./session')])
    return { dispatch, createMcpSession }
  }, settings)
}

async function setup(settings: RelaySettings = {}, init: RequestInit = {}) {
  const { dispatch, createMcpSession } = await loadModules(settings)
  const session = createMcpSession(KEY_CREDENTIAL, request('https://app.example/mcp', init))
  return (message: Parameters<typeof dispatch>[0]) =>
    dispatch(message, { credential: KEY_CREDENTIAL, server: SERVER, session, signal: session.request.signal })
}

function call(name: string, args: Record<string, unknown> = {}, id = 1) {
  return { jsonrpc: '2.0' as const, id, method: 'tools/call', params: { name, arguments: args } }
}

function resultOf(response: unknown) {
  return (response as { result: { content: { text: string }[]; isError: boolean } }).result
}

afterEach(unloadRelay)

describe('tools/list', () => {
  it('returns registry tools plus the four legacy names, with run_query merged', async () => {
    fakeBackend({ sidecar: () => jsonResponse({ tools: REGISTRY_TOOLS }) })
    const run = await setup()

    const response = await run({ jsonrpc: '2.0', id: 1, method: 'tools/list' })

    const tools = (response as { result: { tools: { name: string; description: string; inputSchema: { properties: Record<string, unknown>; required?: string[] } }[] } }).result
      .tools
    const names = tools.map((tool) => tool.name)
    expect(names).toEqual(
      expect.arrayContaining(['list_data_sources', 'open_query', 'list_queries', 'get_query', 'list_dashboards', 'get_dashboard'])
    )
    expect(names.filter((name) => name === 'run_query')).toHaveLength(1)
    const merged = tools.find((tool) => tool.name === 'run_query')
    expect(Object.keys(merged?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['dataSourceId', 'sql', 'query_id', 'parameters', 'max_age'])
    )
    expect(merged?.inputSchema.required ?? []).toEqual([])
    const legacy = tools.find((tool) => tool.name === 'list_queries')
    expect(legacy?.description).toMatch(/search_library/)
  })

  it('sends chatEnabled false so proposal tools are absent when AI is off', async () => {
    const backend = fakeBackend({ sidecar: () => jsonResponse({ tools: REGISTRY_TOOLS }) })
    const run = await setup({ aiEnabled: false })

    await run({ jsonrpc: '2.0', id: 1, method: 'tools/list' })

    expect(backend.sidecarCalls[0].path).toBe('/chat/mcp/tools')
    expect((backend.sidecarCalls[0].body as { chatEnabled: boolean }).chatEnabled).toBe(false)
  })

  it('sends the relay key and a token minted for the caller from node', async () => {
    const backend = fakeBackend({ userId: 42, sidecar: () => jsonResponse({ tools: REGISTRY_TOOLS }) })
    const run = await setup()

    await run({ jsonrpc: '2.0', id: 1, method: 'tools/list' })

    const { headers } = backend.sidecarCalls[0]
    expect(headers.get('authorization')).toBe('Bearer relay-key')
    expect(verifyAiToken(headers.get('x-veodyn-user-token') ?? '', SECRET)?.subject).toBe(42)
  })
})

describe('tools/call through the registry', () => {
  it('runs a client call through the server transport and posts the result', async () => {
    const backend = fakeBackend({
      sidecar: (path) =>
        path === '/chat/mcp/calls'
          ? jsonResponse({ kind: 'client_call', callId: 'c1', tool: 'list_data_sources', args: {} })
          : jsonResponse({ kind: 'done', content: 'Two sources.', isError: false, draft: null }),
      node: (url) =>
        url === `${REDASH}/api/data_sources`
          ? jsonResponse([{ id: 3, name: 'Warehouse', type: 'pg', syntax: 'sql', view_only: false }])
          : jsonResponse({}, 404),
    })
    const run = await setup()

    const result = resultOf(await run(call('list_data_sources')))

    expect(result).toEqual({ content: [{ type: 'text', text: 'Two sources.' }], isError: false })
    const posted = backend.sidecarCalls.find((one) => one.path === '/chat/mcp/calls/c1/result')
    expect((posted?.body as { result: { kind: string; ok: boolean } }).result).toMatchObject({
      kind: 'data_sources',
      ok: true,
    })
    const listed = backend.nodeCalls.find((one) => one.url === `${REDASH}/api/data_sources`)
    expect(new Headers(listed?.init?.headers as HeadersInit).get('authorization')).toBe('Key abc123')
  })

  it('adds a review link block when the call stored a draft', async () => {
    fakeBackend({
      sidecar: () =>
        jsonResponse({
          kind: 'done',
          content: 'Saved a draft.',
          isError: false,
          draft: { draftId: 'd1', version: 1, threadId: 't1', url: '/chat/t1' },
        }),
    })
    const run = await setup({}, { headers: { host: 'app.example' } })

    const result = resultOf(await run(call('propose_query', { name: 'Q' })))

    expect(result.content.map((block) => block.text)).toEqual([
      'Saved a draft.',
      'Review and apply: https://app.example/chat/t1',
    ])
  })

  it('sends the schema of the json data source an update_query lands on in the call body', async () => {
    const backend = fakeBackend({
      sidecar: () => jsonResponse({ kind: 'done', content: 'ok', isError: false, draft: null }),
      node: (url) => {
        if (url === `${REDASH}/api/queries/9`) return jsonResponse({ id: 9, name: 'Stops', data_source_id: 4 })
        if (url === `${REDASH}/api/data_sources/4`) {
          return jsonResponse({ id: 4, name: 'Feed', type: 'json', syntax: 'json', view_only: false })
        }
        if (url === `${REDASH}/api/data_sources/4/schema`) {
          return jsonResponse({ schema: [{ name: 'Resource: stops', columns: ['stop_id'] }] })
        }
        return jsonResponse([])
      },
    })
    const run = await setup()

    await run(call('update_query', { queryId: 9, changes: { name: 'Renamed' } }))

    const sent = backend.sidecarCalls.find((one) => one.path === '/chat/mcp/calls')
    const context = (sent?.body as { context: { schemas?: { dataSourceId: number }[] } }).context
    expect(context.schemas?.map((one) => one.dataSourceId)).toEqual([4])
  })

  it('reports a sidecar done with isError as a tool error', async () => {
    fakeBackend({ sidecar: () => jsonResponse({ kind: 'done', content: 'No such tool.', isError: true, draft: null }) })
    const run = await setup()

    const result = resultOf(await run(call('nope')))

    expect(result).toEqual({ content: [{ type: 'text', text: 'No such tool.' }], isError: true })
  })

  it('answers a thread the caller does not own as a tool error', async () => {
    fakeBackend({ sidecar: () => jsonResponse({ detail: 'missing' }, 404) })
    const run = await setup()

    const result = resultOf(await run(call('propose_query', { threadId: 'someone-elses' })))

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/not found|no such/i)
  })

  it('posts the same-kind ok:false fallback once when the result is refused', async () => {
    let posts = 0
    const backend = fakeBackend({
      sidecar: (path) => {
        if (path === '/chat/mcp/calls') {
          return jsonResponse({ kind: 'client_call', callId: 'c2', tool: 'list_data_sources', args: {} })
        }
        posts += 1
        return posts === 1
          ? jsonResponse({ detail: 'bad shape' }, 422)
          : jsonResponse({ kind: 'done', content: 'Could not read sources.', isError: false, draft: null })
      },
      node: () => jsonResponse([{ id: 3, name: 'Warehouse', type: 'pg', syntax: 'sql', view_only: false }]),
    })
    const run = await setup()

    const result = resultOf(await run(call('list_data_sources')))

    const posted = backend.sidecarCalls.filter((one) => one.path === '/chat/mcp/calls/c2/result')
    expect(posted).toHaveLength(2)
    expect((posted[1].body as { result: unknown }).result).toMatchObject({ kind: 'data_sources', ok: false })
    expect(result.content[0].text).toBe('Could not read sources.')
  })

  it.skipIf(!installsNoFeaturePackages())('does not run a contributed tool server-side, and says so in its own kind', async () => {
    const backend = fakeBackend({
      sidecar: (path) =>
        path === '/chat/mcp/calls'
          ? jsonResponse({ kind: 'client_call', callId: 'c3', tool: 'show_kpi', args: { kpiId: 'revenue' } })
          : jsonResponse({ kind: 'done', content: 'Not available.', isError: true, draft: null }),
    })
    const run = await setup()

    await run(call('show_kpi', { kpiId: 'revenue' }))

    const posted = backend.sidecarCalls.find((one) => one.path === '/chat/mcp/calls/c3/result')
    expect((posted?.body as { result: unknown }).result).toMatchObject({
      kind: 'kpi',
      ok: false,
      error: 'This tool cannot run outside the app.',
    })
  })

  it('checks identity once for a whole batch', async () => {
    const backend = fakeBackend({
      sidecar: () => jsonResponse({ kind: 'done', content: 'ok', isError: false, draft: null }),
    })
    const run = await setup()

    await run(call('search_library', {}, 1))
    await run(call('search_library', {}, 2))

    expect(backend.nodeCalls.filter((one) => one.url === `${REDASH}/api/session`)).toHaveLength(1)
  })

  it('refuses a caller node does not recognise', async () => {
    const backend = fakeBackend({
      session: () => jsonResponse({ message: "Couldn't find resource. Please login and try again." }, 404),
    })
    const run = await setup()

    const result = resultOf(await run(call('search_library')))

    expect(result.isError).toBe(true)
    expect(backend.sidecarCalls).toHaveLength(0)
  })
})

describe('legacy names', () => {
  it('sends run_query with query_id to the old handler and honours max_age', async () => {
    const backend = fakeBackend({
      node: (url) =>
        url.includes('/results')
          ? jsonResponse({ query_result: { data: { columns: [], rows: [] }, retrieved_at: '2026-10-01T00:00:00Z' } })
          : jsonResponse({ id: 3, name: 'Q' }),
    })
    const run = await setup()

    await run(call('run_query', { query_id: 3, max_age: 0 }))

    expect(backend.sidecarCalls).toHaveLength(0)
    const results = backend.nodeCalls.find((one) => one.url.includes('/api/queries/3/results'))
    expect(JSON.parse(String(results?.init?.body))).toMatchObject({ max_age: 0 })
  })

  it('keeps list_queries on its handler without asking the sidecar', async () => {
    const backend = fakeBackend({ node: () => jsonResponse({ count: 0, results: [] }) })
    const run = await setup()

    const result = resultOf(await run(call('list_queries')))

    expect(result.isError).toBe(false)
    expect(backend.sidecarCalls).toHaveLength(0)
  })
})
