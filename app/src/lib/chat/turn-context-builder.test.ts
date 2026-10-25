import { afterEach, describe, expect, it, vi } from 'vitest'
import { THREAD, json, mockChatModules, signedIn, unmockChatModules } from './relay-test-harness'
import type { InstanceProfile } from './turn-context'

afterEach(() => {
  vi.doUnmock('./instance-profile')
  vi.doUnmock('./inventory')
  unmockChatModules()
})

const PROFILE: InstanceProfile = {
  name: 'Meridian Transit',
  edition: 'EE',
  features: ['alerts'],
  plugins: [],
  maps: [{ id: 'maplibre', label: 'Map' }],
}

const SOURCE = {
  id: 3,
  name: 'Meridian feeds',
  type: 'json',
  syntax: 'json',
  viewOnly: false,
  resources: ['incidents'],
}

describe('relay extend', () => {
  it('relay_awaits_async_extend', async () => {
    const fetchMock = vi.fn(async () => json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    mockChatModules()
    const { relayChatJson } = await import('./relay')
    const { z } = await import('zod')
    const response = await relayChatJson(signedIn({ method: 'POST', body: JSON.stringify({ text: 'hi' }) }), {
      method: 'POST',
      path: 'x',
      requestSchema: z.object({ text: z.string() }),
      extend: async () => {
        await Promise.resolve()
        return { late: 1 }
      },
    })
    expect(response.status).toBe(204)
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(sent).toEqual({ text: 'hi', late: 1 })
  })
})

describe('buildTurnContext', () => {
  const request = () => signedIn({ method: 'POST', body: '{}' })

  it('turn_context_builder_survives_inventory_failure', async () => {
    mockChatModules()
    const { buildTurnContext } = await import('./turn-context-builder')
    const context = await buildTurnContext(request(), {
      instance: () => PROFILE,
      dataSources: async () => {
        throw new Error('node is down')
      },
      readyQueries: async () => [],
    })
    expect(context.instance).toEqual(PROFILE)
    expect(context).not.toHaveProperty('dataSources')
    expect(context.readyQueries).toEqual([])
  })

  it('survives_an_instance_profile_failure', async () => {
    mockChatModules()
    const { buildTurnContext } = await import('./turn-context-builder')
    const context = await buildTurnContext(request(), {
      instance: () => {
        throw new Error('config unreadable')
      },
      dataSources: async () => [SOURCE],
    })
    expect(context).not.toHaveProperty('instance')
    expect(context.dataSources).toEqual([SOURCE])
  })

  it('clamps_what_it_collects_to_the_sidecar_limits', async () => {
    mockChatModules()
    const { buildTurnContext } = await import('./turn-context-builder')
    const context = await buildTurnContext(request(), {
      instance: () => PROFILE,
      dataSources: async () => [{ ...SOURCE, name: 'n'.repeat(500) }],
    })
    expect(context.dataSources?.[0].name).toHaveLength(255)
  })

  it('hands_the_analysts_cookie_to_the_parts', async () => {
    mockChatModules()
    const redashFetch = vi.fn(async () => json([]))
    vi.doMock('@/lib/redash-server', () => ({ requireSession: vi.fn(), redashFetch }))
    const { buildTurnContext } = await import('./turn-context-builder')
    const keys: string[] = []
    await buildTurnContext(signedIn({ method: 'POST', body: '{}', headers: { cookie: 'session=abc' } }), {
      dataSources: async (reader, signal) => {
        keys.push(reader.key)
        await reader.get('/api/data_sources', signal)
        return []
      },
    })
    expect(keys).toEqual(['session=abc'])
    expect(redashFetch).toHaveBeenCalledWith('/api/data_sources', expect.objectContaining({ cookie: 'session=abc' }))
  })

  it('reads_through_the_given_getter_and_never_the_requests_cookie', async () => {
    mockChatModules()
    const redashFetch = vi.fn(async () => json([]))
    vi.doMock('@/lib/redash-server', () => ({ requireSession: vi.fn(), redashFetch }))
    const { buildTurnContext } = await import('./turn-context-builder')
    const { dataSourceInventory } = await import('./inventory')
    const paths: string[] = []
    const reader = {
      key: 'mcp:42',
      get: async <T,>(path: string): Promise<T | null> => {
        paths.push(path)
        const sources = [{ id: 3, name: 'Warehouse', type: 'clickhouse', syntax: 'sql' }]
        return (path === '/api/data_sources' ? sources : null) as T | null
      },
    }
    const context = await buildTurnContext(
      signedIn({ method: 'POST', body: '{}', headers: { cookie: 'session=someone-else' } }),
      { dataSources: dataSourceInventory },
      4000,
      reader
    )
    expect(paths).toEqual(['/api/data_sources'])
    expect(context.dataSources).toEqual([
      { id: 3, name: 'Warehouse', type: 'clickhouse', syntax: 'sql', viewOnly: false },
    ])
    expect(redashFetch).not.toHaveBeenCalled()
  })

  it('gives_up_on_a_part_that_never_answers', async () => {
    mockChatModules()
    const { buildTurnContext } = await import('./turn-context-builder')
    const context = await buildTurnContext(
      request(),
      {
        instance: () => PROFILE,
        dataSources: (_reader, signal) =>
          new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
      },
      20
    )
    expect(context.instance).toEqual(PROFILE)
    expect(context).not.toHaveProperty('dataSources')
  })
})

function sentTurn(fetchMock: { mock: { calls: unknown[][] } }, index: number) {
  const turns = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/turns'))
  return JSON.parse(String((turns[index][1] as RequestInit).body)) as { vizCatalog: unknown[] } & Record<string, unknown>
}

describe('turns route', () => {
  it('sends_the_instance_profile_with_the_catalog', async () => {
    const fetchMock = vi.fn(async () => json({ turnId: THREAD, seq: 1 }, 202))
    vi.stubGlobal('fetch', fetchMock)
    mockChatModules()
    vi.doMock('./instance-profile', () => ({ instanceProfile: () => PROFILE }))
    const { POST } = await import('@/app/api/ai/chat/threads/[id]/turns/route')
    const response = await POST(signedIn({ method: 'POST', body: JSON.stringify({ text: 'hi' }) }), {
      params: Promise.resolve({ id: THREAD }),
    })
    expect(response.status).toBe(202)
    const sent = sentTurn(fetchMock, 0)
    expect(sent.instance).toEqual(PROFILE)
    expect(sent.vizCatalog.length).toBeGreaterThan(0)
  })

  it('sends_the_analysts_inventory_and_still_relays_when_it_fails', async () => {
    const fetchMock = vi.fn(async () => json({ turnId: THREAD, seq: 1 }, 202))
    vi.stubGlobal('fetch', fetchMock)
    mockChatModules()
    vi.doMock('./instance-profile', () => ({ instanceProfile: () => PROFILE }))
    const inventory = vi.fn(async () => [SOURCE])
    vi.doMock('./inventory', () => ({ dataSourceInventory: inventory }))
    const { POST } = await import('@/app/api/ai/chat/threads/[id]/turns/route')
    const params = { params: Promise.resolve({ id: THREAD }) }
    const body = JSON.stringify({ text: 'hi' })
    expect((await POST(signedIn({ method: 'POST', body }), params)).status).toBe(202)
    const sent = sentTurn(fetchMock, 0)
    expect(sent.dataSources).toEqual([SOURCE])
    inventory.mockRejectedValue(new Error('node down'))
    expect((await POST(signedIn({ method: 'POST', body }), params)).status).toBe(202)
    const degraded = sentTurn(fetchMock, 1)
    expect(degraded).not.toHaveProperty('dataSources')
    expect(degraded.instance).toEqual(PROFILE)
  })

  it('sends_the_ready_queries_behind_tagged_choices', async () => {
    const fetchMock = vi.fn(async () => json({ turnId: THREAD, seq: 1 }, 202))
    vi.stubGlobal('fetch', fetchMock)
    mockChatModules()
    vi.doMock('./instance-profile', () => ({ instanceProfile: () => PROFILE }))
    const ready = {
      choiceId: 'live-map',
      queryId: 137,
      name: 'Live route',
      dataSourceId: 15,
      visualizationId: 1372,
      params: [],
      more: false,
    }
    vi.doMock('./ready-queries', () => ({ readyQueries: async () => [ready] }))
    const { POST } = await import('@/app/api/ai/chat/threads/[id]/turns/route')
    const params = { params: Promise.resolve({ id: THREAD }) }
    expect((await POST(signedIn({ method: 'POST', body: JSON.stringify({ text: 'hi' }) }), params)).status).toBe(202)
    const sent = sentTurn(fetchMock, 0)
    expect(sent.readyQueries).toEqual([ready])
    vi.doUnmock('./ready-queries')
  })
})
