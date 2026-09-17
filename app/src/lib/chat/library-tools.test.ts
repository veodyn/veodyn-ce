import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/services/api-client'
import { NO_STORED_RESULT, NOT_AVAILABLE } from './library-results'
import { runLibraryTool } from './library-tools'

const queries = vi.hoisted(() => ({ search: vi.fn(), get: vi.fn() }))
const dashboards = vi.hoisted(() => ({ search: vi.fn(), get: vi.fn() }))
const execution = vi.hoisted(() => ({ getResult: vi.fn() }))

vi.mock('@/services/redash/queries', () => queries)
vi.mock('@/services/redash/dashboards', () => dashboards)
vi.mock('@/services/redash/execution', () => execution)

const DATA = { columns: [{ name: 'n', type: 'integer', friendly_name: 'n' }], rows: [{ n: 4 }] }

function savedQuery(overrides: Record<string, unknown> = {}) {
  return {
    id: 12,
    name: 'Trips',
    description: '',
    query: 'SELECT 1',
    data_source_id: 3,
    tags: [],
    is_archived: false,
    visualizations: [{ id: 31, type: 'CHART', name: 'Trips' }],
    latest_query_data_id: 99,
    options: { parameters: [] },
    updated_at: '',
    ...overrides,
  }
}

const signal = () => new AbortController().signal

function search(text: string, kinds: ('query' | 'dashboard')[], tags: string[] = []) {
  return runLibraryTool({ callId: 'c', tool: 'search_library', args: { text, kinds, tags } }, signal())
}

function show(queryId: number, visualizationId: number | null = null) {
  return runLibraryTool({ callId: 'c', tool: 'show_visualization', args: { queryId, visualizationId } }, signal())
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('runLibraryTool', () => {
  it('searches only the kinds asked for, passing tags through', async () => {
    queries.search.mockResolvedValue({ results: [savedQuery()], count: 1 })
    const result = await search('trips', ['query'], ['bikeshare'])
    expect(queries.search).toHaveBeenCalledWith('trips', expect.objectContaining({ tags: ['bikeshare'] }))
    expect(dashboards.search).not.toHaveBeenCalled()
    expect(result).toMatchObject({ kind: 'library', ok: true, items: [{ type: 'query', id: 12 }] })
  })

  it('searches without a tag filter when none is given', async () => {
    queries.search.mockResolvedValue({ results: [], count: 0 })
    dashboards.search.mockResolvedValue({ results: [], count: 0 })
    await search('trips', ['query', 'dashboard'])
    expect(queries.search.mock.calls[0][1].tags).toBeUndefined()
    expect(dashboards.search).toHaveBeenCalledTimes(1)
  })

  it('shows a saved chart from its stored result without running it', async () => {
    queries.get.mockResolvedValue(savedQuery())
    execution.getResult.mockResolvedValue({ data: DATA, retrieved_at: '2026-09-17T06:00:00Z' })
    const result = await show(12)
    expect(execution.getResult).toHaveBeenCalledWith(99, expect.any(AbortSignal))
    expect(result).toMatchObject({
      kind: 'saved_visualization',
      ok: true,
      rowCount: 1,
      visualization: { id: 31 },
      retrievedAt: '2026-09-17T06:00:00Z',
    })
  })

  it('reports a query with no stored result, a missing chart and an archived query', async () => {
    queries.get.mockResolvedValueOnce(savedQuery({ latest_query_data_id: null }))
    expect(await show(12)).toEqual({ kind: 'saved_visualization', ok: false, error: NO_STORED_RESULT })
    queries.get.mockResolvedValueOnce(savedQuery())
    expect(await show(12, 5)).toMatchObject({ ok: false, error: expect.stringContaining('no visualization 5') })
    queries.get.mockResolvedValueOnce(savedQuery({ is_archived: true }))
    expect(await show(12)).toMatchObject({ ok: false, error: NOT_AVAILABLE })
    queries.get.mockResolvedValueOnce(null)
    expect(await show(12)).toMatchObject({ ok: false, error: NOT_AVAILABLE })
    expect(execution.getResult).not.toHaveBeenCalled()
  })

  it('says a forbidden dashboard is not available and passes other failures on', async () => {
    dashboards.get.mockRejectedValueOnce(new ApiError(403, 'forbidden'))
    const open = () => runLibraryTool({ callId: 'c', tool: 'open_dashboard', args: { dashboardId: 4 } }, signal())
    expect(await open()).toEqual({ kind: 'dashboard', ok: false, error: NOT_AVAILABLE })
    dashboards.get.mockRejectedValueOnce(new Error('network down'))
    expect(await open()).toMatchObject({ kind: 'dashboard', ok: false, error: expect.stringContaining('network down') })
  })

  it('rethrows once the caller has aborted', async () => {
    const controller = new AbortController()
    queries.get.mockImplementation(async () => {
      controller.abort()
      throw new Error('aborted')
    })
    await expect(
      runLibraryTool({ callId: 'c', tool: 'show_visualization', args: { queryId: 1, visualizationId: null } }, controller.signal)
    ).rejects.toThrow('aborted')
  })
})
