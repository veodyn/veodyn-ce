import { describe, expect, it, vi } from 'vitest'
import { runLibraryTool } from './library-tools'
import type { RedashTransport } from './transport'

const signal = new AbortController().signal

function page(results: unknown[]) {
  return { count: results.length, page: 1, page_size: 25, results }
}

const LIVE_QUERY = { id: 7, name: 'Weekly revenue', tags: [], is_archived: false, updated_at: 'u', latest_query_data_id: 1 }
const ARCHIVED_QUERY = { ...LIVE_QUERY, id: 8, name: 'Old revenue', is_archived: true }
const ARCHIVED_DASHBOARD = { id: 3, name: 'Ops', slug: 'ops', tags: [], is_archived: true, updated_at: 'u' }

function transportOf() {
  const get = vi.fn(async (path: string) => {
    if (path === 'queries') return page([LIVE_QUERY])
    if (path === 'dashboards') return page([])
    if (path === 'queries/archive') return page([ARCHIVED_QUERY])
    if (path === 'dashboards/archive') return page([ARCHIVED_DASHBOARD])
    throw new Error(`unexpected ${path}`)
  })
  return { get, post: vi.fn(), del: vi.fn() } as unknown as RedashTransport & { get: ReturnType<typeof vi.fn> }
}

function search(archived?: boolean) {
  return {
    callId: 'c1',
    tool: 'search_library' as const,
    args: { text: 'revenue', kinds: ['query' as const, 'dashboard' as const], tags: [], sort: 'match' as const, archived },
  }
}

describe('search_library archived', () => {
  it('lists the archive endpoints and marks each item archived', async () => {
    const transport = transportOf()
    const result = await runLibraryTool(search(true), transport, signal)
    expect(transport.get.mock.calls.map((call) => call[0])).toEqual(['queries/archive', 'dashboards/archive'])
    expect(transport.get.mock.calls[0][1]).toMatchObject({ q: 'revenue' })
    expect(result).toMatchObject({
      kind: 'library',
      ok: true,
      items: [
        { type: 'query', id: 8, name: 'Old revenue', archived: true },
        { type: 'dashboard', id: 3, name: 'Ops', archived: true },
      ],
    })
  })

  it('keeps live searches on the live lists, items marked not archived', async () => {
    for (const archived of [false, undefined]) {
      const transport = transportOf()
      const result = await runLibraryTool(search(archived), transport, signal)
      expect(transport.get.mock.calls.map((call) => call[0])).toEqual(['queries', 'dashboards'])
      expect(result).toMatchObject({ items: [{ type: 'query', id: 7, archived: false }] })
    }
  })
})
