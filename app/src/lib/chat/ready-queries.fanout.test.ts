import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cookieReader } from './redash-get'

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

function query(id: number, withMap = true) {
  return {
    id,
    name: `Query ${id}`,
    data_source_id: 15,
    is_archived: false,
    latest_query_data_id: null,
    options: { parameters: [] },
    visualizations: [{ id: id * 10, type: withMap ? 'TRANSIT_LIVE_MAP' : 'TABLE' }],
  }
}

function serve(tagged: Record<string, number[]>, queries: Record<number, unknown>) {
  redashFetch.mockImplementation(async (path: string) => {
    const listing = /^\/api\/queries\?tags=([^&]+)&page_size=(\d+)$/.exec(path)
    if (listing) {
      const ids = tagged[decodeURIComponent(listing[1])] ?? []
      return reply({ count: ids.length, results: ids.map((id) => ({ id })) })
    }
    const detail = /^\/api\/queries\/(\d+)$/.exec(path)
    if (detail) {
      const found = queries[Number(detail[1])]
      return found ? reply(found) : reply({ message: 'gone' }, 404)
    }
    return reply({}, 404)
  })
}

function matching(ids: number[]) {
  return Object.fromEntries(ids.map((id) => [id, query(id)]))
}

const detailCalls = () => redashFetch.mock.calls.filter(([path]) => /^\/api\/queries\/\d+$/.test(String(path))).length

async function ready(cookie: string | null = 'session=a', signal: AbortSignal = SIGNAL) {
  const { readyQueries } = await import('./ready-queries')
  return readyQueries(cookieReader(cookie), signal)
}

beforeEach(() => {
  redashFetch.mockReset()
  choices.list = [LIVE_MAP]
  vi.resetModules()
})

describe('readyQueries fan-out', () => {
  it('cap_before_fetch_stops_reading_details_once_enough_queries_match', async () => {
    const ids = Array.from({ length: 25 }, (_, index) => index + 1)
    serve({ 'live-map': ids }, matching(ids))
    const result = await ready()
    expect(result).toHaveLength(20)
    expect(detailCalls()).toBeLessThanOrEqual(20)
    expect(result.every((one) => one.more)).toBe(true)
  })

  it('keeps_reading_past_the_cap_window_while_matches_are_scarce', async () => {
    const ids = Array.from({ length: 31 }, (_, index) => index + 1)
    const queries: Record<number, unknown> = Object.fromEntries(ids.map((id) => [id, query(id, false)]))
    queries[31] = query(31)
    serve({ 'live-map': ids }, queries)
    expect((await ready()).map((one) => one.queryId)).toEqual([31])
  })

  it('a_query_tagged_for_two_choices_is_fetched_once', async () => {
    choices.list = [LIVE_MAP, { ...LIVE_MAP, id: 'live-map-two', libraryTag: 'also-live' }]
    serve({ 'live-map': [137], 'also-live': [137] }, matching([137]))
    await ready()
    expect(redashFetch.mock.calls.filter(([path]) => path === '/api/queries/137')).toHaveLength(1)
  })

  it('aborted_results_are_not_cached', async () => {
    serve({ 'live-map': [137] }, matching([137]))
    const controller = new AbortController()
    controller.abort()
    await ready('session=a', controller.signal)
    const afterAborted = redashFetch.mock.calls.length
    await ready('session=a')
    expect(redashFetch.mock.calls.length).toBeGreaterThan(afterAborted)
  })

  it('a_result_built_after_a_failed_fetch_is_not_cached', async () => {
    serve({ 'live-map': [137, 138] }, matching([137]))
    await ready()
    const first = redashFetch.mock.calls.length
    await ready()
    expect(redashFetch.mock.calls.length).toBeGreaterThan(first)
  })

  it('concurrent_calls_for_one_analyst_share_one_fan_out', async () => {
    serve({ 'live-map': [137] }, matching([137]))
    const [first, second] = await Promise.all([ready(), ready()])
    expect(first).toEqual(second)
    expect(redashFetch.mock.calls.filter(([path]) => String(path).startsWith('/api/queries?'))).toHaveLength(1)
  })

  it('a_failed_fan_out_does_not_poison_the_next_call', async () => {
    redashFetch.mockRejectedValueOnce(new Error('socket hang up'))
    serve({ 'live-map': [137] }, matching([137]))
    await ready()
    expect(await ready()).toHaveLength(1)
  })
})
