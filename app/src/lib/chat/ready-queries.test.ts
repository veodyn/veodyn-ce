import { beforeEach, describe, expect, it, vi } from 'vitest'

const redashFetch = vi.hoisted(() => vi.fn())
const choices = vi.hoisted(() => ({ list: [] as unknown[] }))

vi.mock('@/lib/redash-server', () => ({ redashFetch }))
vi.mock('@/lib/config', () => ({ config: { visualizations: { enabled: null, audience: {} } } }))
vi.mock('@/lib/viz-choices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/viz-choices')>()),
  visibleVizChoices: () => choices.list,
}))

const SIGNAL = new AbortController().signal
const LIVE_MAP = { id: 'live-map', type: 'TRANSIT_LIVE_MAP', label: 'Live map', libraryTag: 'live-map' }

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

interface Stub {
  tagged: Record<string, { count: number; ids: number[] }>
  queries: Record<number, Record<string, unknown>>
  results?: Record<number, { columns: { name: string }[]; rows: Record<string, unknown>[] }>
}

function query(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Query ${id}`,
    data_source_id: 15,
    is_archived: false,
    latest_query_data_id: null,
    options: { parameters: [] },
    visualizations: [{ id: id * 10, type: 'TABLE', name: 'Table' }],
    ...overrides,
  }
}

function serve(stub: Stub) {
  redashFetch.mockImplementation(async (path: string) => {
    const listing = /^\/api\/queries\?tags=([^&]+)&page_size=(\d+)$/.exec(path)
    if (listing) {
      const entry = stub.tagged[decodeURIComponent(listing[1])]
      if (!entry) return reply({ count: 0, results: [] })
      return reply({ count: entry.count, results: entry.ids.map((id) => ({ id })) })
    }
    const detail = /^\/api\/queries\/(\d+)$/.exec(path)
    if (detail) {
      const found = stub.queries[Number(detail[1])]
      return found ? reply(found) : reply({ message: 'gone' }, 404)
    }
    const stored = /^\/api\/query_results\/(\d+)$/.exec(path)
    if (stored) {
      const found = stub.results?.[Number(stored[1])]
      return found ? reply({ query_result: { data: found } }) : reply({ message: 'gone' }, 404)
    }
    return reply({}, 404)
  })
}

async function ready(cookie: string | null = 'session=a') {
  const { readyQueries } = await import('./ready-queries')
  return readyQueries(cookie, SIGNAL)
}

beforeEach(() => {
  redashFetch.mockReset()
  choices.list = [LIVE_MAP]
  vi.resetModules()
})

describe('readyQueries', () => {
  it('tag_filter_keeps_only_queries_with_a_visualization_of_the_choice_type', async () => {
    const ids = Array.from({ length: 31 }, (_, index) => index + 100)
    const queries = Object.fromEntries(ids.map((id) => [id, query(id)]))
    queries[137] = query(137, {
      name: 'Live route',
      visualizations: [
        { id: 1371, type: 'TABLE', name: 'Table' },
        { id: 1372, type: 'TRANSIT_LIVE_MAP', name: 'Map' },
      ],
    })
    ids.push(137)
    serve({ tagged: { 'live-map': { count: 32, ids } }, queries })
    const result = await ready()
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      choiceId: 'live-map',
      queryId: 137,
      name: 'Live route',
      dataSourceId: 15,
      visualizationId: 1372,
      params: [],
      more: false,
    })
  })

  it('lists_tagged_queries_with_the_analysts_cookie', async () => {
    serve({ tagged: {}, queries: {} })
    await ready('session=zed')
    expect(redashFetch).toHaveBeenCalledWith(
      '/api/queries?tags=live-map&page_size=50',
      expect.objectContaining({ cookie: 'session=zed' })
    )
  })

  it('query_param_carries_backing_values_capped_and_flagged', async () => {
    serve({
      tagged: { 'live-map': { count: 1, ids: [137] } },
      queries: {
        137: query(137, {
          visualizations: [{ id: 1372, type: 'TRANSIT_LIVE_MAP' }],
          options: { parameters: [{ name: 'route', type: 'query', value: 'R020', queryId: 136 }] },
        }),
        136: query(136, { latest_query_data_id: 900 }),
      },
      results: {
        900: {
          columns: [{ name: 'route' }],
          rows: Array.from({ length: 60 }, (_, index) => ({ route: `MT${String(index).padStart(3, '0')}` })),
        },
      },
    })
    const [entry] = await ready()
    const [param] = entry.params
    expect(param).toMatchObject({ name: 'route', type: 'query', default: 'R020', backingQueryId: 136 })
    expect(param.values).toHaveLength(50)
    expect(param.values[0]).toBe('MT000')
    expect(param.valuesTruncated).toBe(true)
  })

  it('backing_query_without_stored_result_gives_empty_values', async () => {
    serve({
      tagged: { 'live-map': { count: 1, ids: [137] } },
      queries: {
        137: query(137, {
          visualizations: [{ id: 1372, type: 'TRANSIT_LIVE_MAP' }],
          options: { parameters: [{ name: 'route', type: 'query', value: 'R020', queryId: 136 }] },
        }),
        136: query(136, { latest_query_data_id: null }),
      },
    })
    const result = await ready()
    expect(result).toHaveLength(1)
    expect(result[0].params[0]).toMatchObject({ name: 'route', values: [], backingQueryId: 136 })
    expect(result[0].params[0].valuesTruncated).toBeFalsy()
  })

  it('a_backing_query_that_cannot_be_read_still_sends_the_ready_query', async () => {
    serve({
      tagged: { 'live-map': { count: 1, ids: [137] } },
      queries: {
        137: query(137, {
          visualizations: [{ id: 1372, type: 'TRANSIT_LIVE_MAP' }],
          options: { parameters: [{ name: 'route', type: 'query', value: 'R020', queryId: 999 }] },
        }),
      },
    })
    const result = await ready()
    expect(result[0].params[0]).toMatchObject({ values: [], backingQueryId: 999 })
  })

  it('values_follow_the_value_column_the_way_node_validates_them', async () => {
    serve({
      tagged: { 'live-map': { count: 1, ids: [137] } },
      queries: {
        137: query(137, {
          visualizations: [{ id: 1372, type: 'TRANSIT_LIVE_MAP' }],
          options: { parameters: [{ name: 'route', type: 'query', value: 'R720', queryId: 136 }] },
        }),
        136: query(136, { latest_query_data_id: 900 }),
      },
      results: {
        900: {
          columns: [{ name: 'Name' }, { name: 'Value' }],
          rows: [
            { Name: '720', Value: 'R720' },
            { Name: '20', Value: 'R020' },
          ],
        },
      },
    })
    const [entry] = await ready()
    expect(entry.params[0].values).toEqual(['R720', 'R020'])
  })

  it('plain_params_carry_name_type_and_scalar_default_only', async () => {
    serve({
      tagged: { 'live-map': { count: 1, ids: [137] } },
      queries: {
        137: query(137, {
          visualizations: [{ id: 1372, type: 'TRANSIT_LIVE_MAP' }],
          options: {
            parameters: [
              { name: 'limit', type: 'number', value: 25 },
              { name: 'window', type: 'date-range', value: { start: 'a', end: 'b' } },
            ],
          },
        }),
      },
    })
    const [entry] = await ready()
    expect(entry.params[0]).toMatchObject({ name: 'limit', type: 'number', default: 25, values: [] })
    expect(entry.params[1].default ?? null).toBeNull()
    expect(entry.params[1].values).toEqual([])
  })

  it('more_is_set_when_the_tag_listing_has_further_queries', async () => {
    serve({
      tagged: { 'live-map': { count: 80, ids: [137] } },
      queries: { 137: query(137, { visualizations: [{ id: 1372, type: 'TRANSIT_LIVE_MAP' }] }) },
    })
    expect((await ready())[0].more).toBe(true)
  })

  it('more_is_set_when_the_global_cap_cuts_matching_queries', async () => {
    const ids = Array.from({ length: 21 }, (_, index) => index + 1)
    serve({
      tagged: { 'live-map': { count: 21, ids } },
      queries: Object.fromEntries(
        ids.map((id) => [id, query(id, { visualizations: [{ id: id * 10, type: 'TRANSIT_LIVE_MAP' }] })])
      ),
    })
    const result = await ready()
    expect(result).toHaveLength(20)
    expect(result.at(-1)?.more).toBe(true)
  })

  it('more_stays_false_when_nothing_was_cut', async () => {
    serve({
      tagged: { 'live-map': { count: 1, ids: [137] } },
      queries: { 137: query(137, { visualizations: [{ id: 1372, type: 'TRANSIT_LIVE_MAP' }] }) },
    })
    expect((await ready())[0].more).toBe(false)
  })

  it('skips_archived_queries_and_ones_that_fail_to_load', async () => {
    serve({
      tagged: { 'live-map': { count: 3, ids: [1, 2, 3] } },
      queries: {
        1: query(1, { is_archived: true, visualizations: [{ id: 11, type: 'TRANSIT_LIVE_MAP' }] }),
        3: query(3, { visualizations: [{ id: 31, type: 'TRANSIT_LIVE_MAP' }] }),
      },
    })
    expect((await ready()).map((entry) => entry.queryId)).toEqual([3])
  })

  it('choices_without_a_library_tag_cost_no_requests', async () => {
    choices.list = [{ id: 'table', type: 'TABLE', label: 'Table' }]
    expect(await ready()).toEqual([])
    expect(redashFetch).not.toHaveBeenCalled()
  })

  it('a_node_refusal_on_the_listing_gives_no_queries_for_that_choice', async () => {
    redashFetch.mockResolvedValue(reply({ message: 'no' }, 500))
    expect(await ready()).toEqual([])
  })

  it('serves_the_same_analyst_from_a_short_cache_and_another_analyst_fresh', async () => {
    serve({
      tagged: { 'live-map': { count: 1, ids: [137] } },
      queries: { 137: query(137, { visualizations: [{ id: 1372, type: 'TRANSIT_LIVE_MAP' }] }) },
    })
    await ready('session=a')
    const afterFirst = redashFetch.mock.calls.length
    await ready('session=a')
    expect(redashFetch.mock.calls.length).toBe(afterFirst)
    await ready('session=b')
    expect(redashFetch.mock.calls.length).toBeGreaterThan(afterFirst)
  })
})
