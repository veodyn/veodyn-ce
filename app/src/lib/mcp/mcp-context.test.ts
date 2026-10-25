// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import {
  fakeBackend,
  jsonResponse,
  KEY_CREDENTIAL,
  loadWithRelay,
  REDASH,
  request,
  unloadRelay,
} from './mcp-registry-fixtures'

const JSON_SOURCE = { id: 4, name: 'Feed', type: 'json', syntax: 'json', view_only: false }
const SOURCES = [{ id: 3, name: 'Warehouse', type: 'pg', syntax: 'sql', view_only: false }]

function nodeFor(url: string) {
  if (url === `${REDASH}/api/data_sources`) return jsonResponse(SOURCES)
  if (url === `${REDASH}/api/data_sources/3`) return jsonResponse(SOURCES[0])
  if (url === `${REDASH}/api/data_sources/4`) return jsonResponse(JSON_SOURCE)
  if (url === `${REDASH}/api/data_sources/4/schema`) {
    return jsonResponse({ schema: [{ name: 'Resource: stops', columns: ['stop_id'] }] })
  }
  if (url === `${REDASH}/api/queries/9`) return jsonResponse({ id: 9, name: 'Stops', data_source_id: 4 })
  if (url === `${REDASH}/api/data_sources/3/schema`) {
    return jsonResponse({ schema: [{ name: 'trips', columns: ['id', 'duration'] }] })
  }
  return jsonResponse({}, 404)
}

async function context(args: Record<string, unknown>, tool?: string) {
  const { buildMcpContext, createMcpSession } = await loadWithRelay(async () => {
    const [{ buildMcpContext }, { createMcpSession }] = await Promise.all([
      import('./mcp-context'),
      import('./session'),
    ])
    return { buildMcpContext, createMcpSession }
  })
  const session = createMcpSession(KEY_CREDENTIAL, request())
  const identity = await session.identity()
  if (!identity) throw new Error('no identity')
  return buildMcpContext(session, identity, args, new AbortController().signal, tool)
}

afterEach(unloadRelay)

describe('buildMcpContext', () => {
  it('carries the instance and the data source inventory read as the caller', async () => {
    const backend = fakeBackend({ node: nodeFor })

    const built = await context({})

    expect(built.instance?.name).toBeTruthy()
    expect(built.dataSources?.map((one) => one.id)).toEqual([3])
    expect(built.schemas ?? []).toEqual([])
    for (const one of backend.nodeCalls) {
      expect(new Headers(one.init?.headers as HeadersInit).get('authorization')).toBe('Key abc123')
    }
  })

  it('adds the described schema of a data source the call names', async () => {
    fakeBackend({ node: nodeFor })

    const built = await context({ dataSourceId: 3, sql: 'select 1' })

    expect(built.schemas).toHaveLength(1)
    expect(built.schemas?.[0]).toMatchObject({ kind: 'data_source_schema', ok: true, dataSourceId: 3 })
  })

  it('adds the schema of the data source an update_query will land on, from the saved query', async () => {
    fakeBackend({ node: nodeFor })

    const built = await context({ queryId: 9, changes: { name: 'Renamed' } }, 'update_query')

    expect(built.schemas?.[0]).toMatchObject({ kind: 'data_source_schema', dataSourceId: 4 })
  })

  it('prefers the data source the update_query moves the query to', async () => {
    fakeBackend({ node: nodeFor })

    const built = await context({ queryId: 9, changes: { dataSourceId: 3 } }, 'update_query')

    expect(built.schemas?.[0]).toMatchObject({ dataSourceId: 3 })
  })

  it('leaves the schema out when describing it fails', async () => {
    fakeBackend({ node: (url) => (url.endsWith('/schema') ? jsonResponse({}, 500) : nodeFor(url)) })

    const built = await context({ dataSourceId: 3 })

    expect(built.schemas ?? []).toEqual([])
  })
})
