// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CREDENTIAL,
  json,
  loadDashboardTools,
  mockFetchSequence,
  REDASH,
} from '@/lib/mcp/mcp-test-fixtures'

beforeEach(() => {
  process.env.REDASH_URL = REDASH
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.REDASH_URL
})

describe('list_dashboards', () => {
  it('filters by name here rather than trusting Redash search', async () => {
    // The dashboard `q` parameter is backed by a search index that a working
    // instance can have empty: on the local stack it returns nothing even for
    // an exact dashboard name, while query search works. Filtering over the
    // pages costs a request or two and answers the same on every instance.
    const spy = mockFetchSequence([
      json({
        count: 3,
        results: [
          { id: 1, name: 'Regional: Overview', slug: 'regional-overview' },
          { id: 2, name: 'Fleet status', slug: 'fleet-status' },
        ],
      }),
    ])
    const { listDashboards } = await loadDashboardTools()

    const result = await listDashboards({ search: 'overview' }, CREDENTIAL)

    expect(String(spy.mock.calls[0][0])).not.toContain('q=')
    expect(result.dashboards.map((d) => d.slug)).toEqual(['regional-overview'])
  })

  it('matches case-insensitively', async () => {
    mockFetchSequence([
      json({ count: 1, results: [{ id: 1, name: 'Regional: Overview', slug: 'regional-overview' }] }),
    ])
    const { listDashboards } = await loadDashboardTools()

    expect((await listDashboards({ search: 'Regional' }, CREDENTIAL)).count).toBe(1)
  })

  it('says when it cut the list short, instead of implying that is all of them', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      name: `Dashboard ${i + 1}`,
      slug: `dashboard-${i + 1}`,
    }))
    mockFetchSequence([json({ count: 250, results: many })])
    const { listDashboards } = await loadDashboardTools()

    const result = await listDashboards({ page_size: 5 }, CREDENTIAL)

    expect(result.dashboards).toHaveLength(5)
    expect(result.note).toMatch(/first 5/)
  })

  it('stops reading pages once a short page says there are no more', async () => {
    const spy = mockFetchSequence([
      json({ count: 1, results: [{ id: 1, name: 'Only one', slug: 'only-one' }] }),
    ])
    const { listDashboards } = await loadDashboardTools()

    await listDashboards({}, CREDENTIAL)

    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('get_dashboard', () => {
  it('names the query behind each widget, so the model can go run it', async () => {
    mockFetchSequence([
      json({ count: 1, results: [{ id: 1, name: 'Network', slug: 'network' }] }),
      json({
        id: 1,
        name: 'Network',
        slug: 'network',
        widgets: [
          { id: 10, visualization: { id: 3, name: 'Trend', type: 'CHART', query: { id: 7, name: 'Rail' } } },
          { id: 11, text: 'A heading' },
        ],
      }),
    ])
    const { getDashboard } = await loadDashboardTools()

    const result = await getDashboard({ dashboard: 'network' }, CREDENTIAL)

    expect(result.widgets).toEqual([
      {
        id: 10,
        text: undefined,
        visualization: { name: 'Trend', type: 'CHART', query_id: 7, query_name: 'Rail' },
      },
      { id: 11, text: 'A heading', visualization: undefined },
    ])
  })

  it('reads a numeric id in one request', async () => {
    const spy = mockFetchSequence([json({ id: 4, name: 'Network', slug: 'network' })])
    const { getDashboard } = await loadDashboardTools()

    await getDashboard({ dashboard: '4' }, CREDENTIAL)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(String(spy.mock.calls[0][0])).toBe(`${REDASH}/api/dashboards/4`)
  })

  it('resolves a slug to an id first, because the endpoint takes only ids', async () => {
    // Handing the slug straight to Redash puts it into WHERE dashboards.id =
    // 'network' and the request dies as a Postgres cast error behind an HTML
    // 500. Verified against a live instance.
    const spy = mockFetchSequence([
      json({ count: 1, results: [{ id: 4, name: 'Network', slug: 'network' }] }),
      json({ id: 4, name: 'Network', slug: 'network' }),
    ])
    const { getDashboard } = await loadDashboardTools()

    const result = await getDashboard({ dashboard: 'network' }, CREDENTIAL)

    // Read from the list rather than searched: Redash's dashboard `q` is backed
    // by an index that a working instance can have empty, and it returns
    // nothing there even for an exact name. Verified against a live instance.
    expect(String(spy.mock.calls[0][0])).toContain('/api/dashboards?page=1')
    expect(String(spy.mock.calls[0][0])).not.toContain('q=')
    expect(String(spy.mock.calls[1][0])).toBe(`${REDASH}/api/dashboards/4`)
    expect(result.id).toBe(4)
  })

  it('says a slug matched nothing rather than passing a near miss along', async () => {
    mockFetchSequence([json({ count: 1, results: [{ id: 9, name: 'Other', slug: 'other' }] })])
    const { getDashboard } = await loadDashboardTools()

    await expect(getDashboard({ dashboard: 'network' }, CREDENTIAL)).rejects.toThrow(
      /No dashboard with the id or slug "network"/
    )
  })

  it('never puts a caller string into the dashboard path', async () => {
    // Only a value that is all digits reaches /api/dashboards/<id>; anything
    // else is matched against the list first, so a path cannot be traversed.
    const spy = mockFetchSequence([json({ count: 0, results: [] })])
    const { getDashboard } = await loadDashboardTools()

    await expect(getDashboard({ dashboard: '../users/1' }, CREDENTIAL)).rejects.toThrow(
      /No dashboard with the id or slug/
    )

    expect(spy.mock.calls.every(([url]) => !String(url).includes('users'))).toBe(true)
  })

  it('refuses an empty identifier', async () => {
    const { getDashboard } = await loadDashboardTools()

    await expect(getDashboard({ dashboard: '  ' }, CREDENTIAL)).rejects.toThrow(TypeError)
  })
})
