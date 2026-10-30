import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/services/api-client'
import * as nodeCalls from './node-calls'
import type { RedashTransport } from './transport'

function fakeTransport() {
  const get = vi.fn()
  const post = vi.fn()
  const del = vi.fn()
  const transport: RedashTransport = { get, post, del } as unknown as RedashTransport
  return { transport, get, post, del }
}

const SIGNAL = new AbortController().signal
const RESULT = { id: 9, data: { columns: [], rows: [] }, retrieved_at: 't' }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('data sources', () => {
  it('lists data sources at data_sources', async () => {
    const { transport, get } = fakeTransport()
    get.mockResolvedValue([{ id: 1 }])
    expect(await nodeCalls.listDataSources(transport, SIGNAL)).toEqual([{ id: 1 }])
    expect(get).toHaveBeenCalledWith('data_sources', undefined, SIGNAL)
  })

  it('reads one data source and answers null on 404', async () => {
    const { transport, get } = fakeTransport()
    get.mockResolvedValueOnce({ id: 3 })
    expect(await nodeCalls.getDataSource(transport, 3, SIGNAL)).toEqual({ id: 3 })
    expect(get).toHaveBeenCalledWith('data_sources/3', undefined, SIGNAL)
    get.mockRejectedValueOnce(new ApiError(404, 'nope'))
    expect(await nodeCalls.getDataSource(transport, 3, SIGNAL)).toBeNull()
    get.mockRejectedValueOnce(new ApiError(500, 'boom'))
    await expect(nodeCalls.getDataSource(transport, 3, SIGNAL)).rejects.toThrow('boom')
  })

  it('normalizes a direct schema, strings and typed columns alike', async () => {
    const { transport, get } = fakeTransport()
    get.mockResolvedValue({ schema: [{ name: 't', columns: ['a', { name: 'b', type: 'int' }] }, { name: 'u' }] })
    expect(await nodeCalls.getSchema(transport, 1, false, SIGNAL)).toEqual([
      {
        name: 't',
        columns: [
          { name: 'a', type: '' },
          { name: 'b', type: 'int' },
        ],
      },
      { name: 'u', columns: [] },
    ])
    expect(get).toHaveBeenCalledWith('data_sources/1/schema', undefined, SIGNAL)
  })

  it('sends refresh and polls the schema job until it finishes', async () => {
    const { transport, get } = fakeTransport()
    get
      .mockResolvedValueOnce({ job: { id: 'j1' } })
      .mockResolvedValueOnce({ job: { id: 'j1', status: 2 } })
      .mockResolvedValueOnce({ job: { id: 'j1', status: 3, result: [{ name: 't', columns: ['a'] }] } })
    const pending = nodeCalls.getSchema(transport, 1, true, SIGNAL)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toEqual([{ name: 't', columns: [{ name: 'a', type: '' }] }])
    expect(get).toHaveBeenNthCalledWith(1, 'data_sources/1/schema', { refresh: true }, SIGNAL)
    expect(get).toHaveBeenNthCalledWith(2, 'jobs/j1', undefined, SIGNAL)
  })

  it('fails a schema job that fails or is cancelled', async () => {
    const { transport, get } = fakeTransport()
    get.mockResolvedValueOnce({ job: { id: 'j' } }).mockResolvedValueOnce({ job: { status: 4, error: 'bad' } })
    await expect(nodeCalls.getSchema(transport, 1, false, SIGNAL)).rejects.toThrow('bad')
    get.mockResolvedValueOnce({ job: { id: 'j' } }).mockResolvedValueOnce({ job: { status: 5 } })
    await expect(nodeCalls.getSchema(transport, 1, false, SIGNAL)).rejects.toThrow('Schema refresh cancelled')
  })

  it('answers no tables for a data source whose runner cannot list a schema', async () => {
    const { transport, get } = fakeTransport()
    get
      .mockResolvedValueOnce({ job: { id: 'j' } })
      .mockResolvedValueOnce({ job: { status: 4, error: { code: 1, message: 'not supported' } } })
    expect(await nodeCalls.getSchema(transport, 15, false, SIGNAL)).toEqual([])
    get
      .mockResolvedValueOnce({ job: { id: 'j' } })
      .mockResolvedValueOnce({ job: { status: 4, error: { code: 2, message: 'Error retrieving schema' } } })
    await expect(nodeCalls.getSchema(transport, 15, false, SIGNAL)).rejects.toThrow('Error retrieving schema')
  })

  it('times a schema job out after thirty seconds', async () => {
    const { transport, get } = fakeTransport()
    get.mockImplementation(async (path: string) =>
      path.startsWith('jobs/') ? { job: { status: 2 } } : { job: { id: 'j' } }
    )
    const pending = nodeCalls.getSchema(transport, 1, false, SIGNAL)
    const settled = expect(pending).rejects.toThrow('Schema refresh timed out')
    await vi.advanceTimersByTimeAsync(31_000)
    await settled
  })
})

describe('library reads', () => {
  it('searches queries with the list params and normalizes the page', async () => {
    const { transport, get } = fakeTransport()
    get.mockResolvedValue({
      count: 1,
      page: 1,
      page_size: 25,
      results: [{ id: 5, name: 'q', query: 'select 1', data_source_id: 1 }],
    })
    const page = await nodeCalls.searchQueries(transport, 'trips', {
      signal: SIGNAL,
      tags: ['a'],
      order: '-updated_at',
    })
    expect(get).toHaveBeenCalledWith(
      'queries',
      { page: 1, page_size: 25, q: 'trips', tags: ['a'], order: '-updated_at' },
      SIGNAL
    )
    expect(page.results[0]).toMatchObject({
      id: 5,
      description: '',
      tags: [],
      is_archived: false,
      latest_query_data_id: null,
    })
  })

  it('omits an empty search and an empty tag list', async () => {
    const { transport, get } = fakeTransport()
    get.mockResolvedValue({ count: 0, results: [] })
    await nodeCalls.searchQueries(transport, '', { tags: [] })
    expect(get).toHaveBeenCalledWith(
      'queries',
      { page: 1, page_size: 25, q: undefined, tags: undefined, order: undefined },
      undefined
    )
  })

  it('reads one query, null on 404', async () => {
    const { transport, get } = fakeTransport()
    get.mockResolvedValueOnce({ id: 12, name: 'x', query: 's', data_source_id: 1 })
    expect(await nodeCalls.getQuery(transport, 12, SIGNAL)).toMatchObject({ id: 12, visualizations: [] })
    expect(get).toHaveBeenCalledWith('queries/12', undefined, SIGNAL)
    get.mockRejectedValueOnce(new ApiError(404, 'no'))
    expect(await nodeCalls.getQuery(transport, 12, SIGNAL)).toBeNull()
  })

  it('searches dashboards with the page size', async () => {
    const { transport, get } = fakeTransport()
    get.mockResolvedValue({ count: 1, results: [{ id: 4, name: 'd' }] })
    const page = await nodeCalls.searchDashboards(transport, '', { signal: SIGNAL, pageSize: 50 })
    expect(get).toHaveBeenCalledWith('dashboards', { page: 1, page_size: 50, q: undefined, tags: undefined }, SIGNAL)
    expect(page.results[0]).toMatchObject({ id: 4, slug: '4', widgets: [] })
  })

  it('reads one dashboard, null on 404', async () => {
    const { transport, get } = fakeTransport()
    get.mockResolvedValueOnce({ id: 4, name: 'd' })
    expect(await nodeCalls.getDashboard(transport, 4, SIGNAL)).toMatchObject({ id: 4 })
    expect(get).toHaveBeenCalledWith('dashboards/4', undefined, SIGNAL)
    get.mockRejectedValueOnce(new ApiError(404, 'no'))
    expect(await nodeCalls.getDashboard(transport, 4, SIGNAL)).toBeNull()
  })

  it('unwraps a stored result', async () => {
    const { transport, get } = fakeTransport()
    get.mockResolvedValue({ query_result: RESULT })
    expect(await nodeCalls.getQueryResult(transport, 9, SIGNAL)).toEqual(RESULT)
    expect(get).toHaveBeenCalledWith('query_results/9', undefined, SIGNAL, undefined)
  })

  it('reads either tag vocabulary envelope from the scope path', async () => {
    const { transport, get } = fakeTransport()
    get.mockResolvedValueOnce({ tags: [{ name: 'a', count: 2 }, { nope: 1 }] })
    expect(await nodeCalls.tagVocabulary(transport, 'queries', SIGNAL)).toEqual([{ name: 'a', count: 2 }])
    expect(get).toHaveBeenCalledWith('queries/tags', undefined, SIGNAL)
    get.mockResolvedValueOnce([{ name: 'b' }])
    expect(await nodeCalls.tagVocabulary(transport, 'dashboards', SIGNAL)).toEqual([{ name: 'b', count: 0 }])
    expect(get).toHaveBeenLastCalledWith('dashboards/tags', undefined, SIGNAL)
  })
})

describe('execution', () => {
  it('runs a saved query: body, then the inline result', async () => {
    const { transport, post } = fakeTransport()
    post.mockResolvedValue({ query_result: RESULT })
    const result = await nodeCalls.executeSavedQuery(transport, 12, {
      parameters: { a: 1 },
      maxAge: 0,
      signal: SIGNAL,
    })
    expect(result).toEqual(RESULT)
    expect(post).toHaveBeenCalledWith('queries/12/results', { max_age: 0, parameters: { a: 1 } }, SIGNAL)
  })

  it('omits max_age, empty parameters and auto limit when unset', async () => {
    const { transport, post } = fakeTransport()
    post.mockResolvedValue({ query_result: RESULT })
    await nodeCalls.executeSavedQuery(transport, 12, { parameters: {} })
    expect(post).toHaveBeenCalledWith('queries/12/results', {}, undefined)
  })

  it('runs ad hoc SQL with max_age 0, then polls the job and fetches the result', async () => {
    const { transport, get, post } = fakeTransport()
    post.mockResolvedValue({ job: { id: 'j9' } })
    get
      .mockResolvedValueOnce({ job: { status: 1 } })
      .mockResolvedValueOnce({ job: { status: 3, query_result_id: 9 } })
      .mockResolvedValueOnce({ query_result: RESULT })
    const onJob = vi.fn()
    const pending = nodeCalls.executeAdhoc(transport, 4, 'SELECT 1', {
      applyAutoLimit: true,
      signal: SIGNAL,
      onJob,
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toEqual(RESULT)
    expect(post).toHaveBeenCalledWith(
      'query_results',
      { data_source_id: 4, query: 'SELECT 1', max_age: 0, apply_auto_limit: true },
      SIGNAL
    )
    expect(onJob).toHaveBeenCalledWith('j9')
    expect(get).toHaveBeenNthCalledWith(1, 'jobs/j9', undefined, SIGNAL)
    expect(get).toHaveBeenLastCalledWith('query_results/9', undefined, SIGNAL, undefined)
  })

  it('a result byte cap reaches only the result download', async () => {
    const { transport, get, post } = fakeTransport()
    post.mockResolvedValue({ job: { id: 'j' } })
    get.mockResolvedValueOnce({ job: { status: 3, query_result_id: 9 } }).mockResolvedValueOnce({ query_result: RESULT })
    await nodeCalls.executeAdhoc(transport, 4, 'SELECT 1', { signal: SIGNAL, maxResultBytes: 1024 })
    expect(get).toHaveBeenNthCalledWith(1, 'jobs/j', undefined, SIGNAL)
    expect(get).toHaveBeenLastCalledWith('query_results/9', undefined, SIGNAL, { maxBytes: 1024 })
  })

  it('reads the job result id under the older field names', async () => {
    const { transport, get, post } = fakeTransport()
    post.mockResolvedValue({ job: { id: 'j' } })
    get.mockResolvedValueOnce({ job: { status: 3, result: 7 } }).mockResolvedValueOnce({ query_result: RESULT })
    await nodeCalls.executeAdhoc(transport, 4, 'SELECT 1')
    expect(get).toHaveBeenLastCalledWith('query_results/7', undefined, undefined, undefined)
  })

  it('fails with the job error, on cancel, and on no result id', async () => {
    const { transport, get, post } = fakeTransport()
    post.mockResolvedValue({ job: { id: 'j' } })
    get.mockResolvedValueOnce({ job: { status: 4, error: 'syntax error' } })
    await expect(nodeCalls.executeAdhoc(transport, 4, 'x')).rejects.toThrow('syntax error')
    get.mockResolvedValueOnce({ job: { status: 5 } })
    await expect(nodeCalls.executeAdhoc(transport, 4, 'x')).rejects.toThrow('Query execution was cancelled')
    get.mockResolvedValueOnce({ job: { status: 3 } })
    await expect(nodeCalls.executeAdhoc(transport, 4, 'x')).rejects.toThrow('Job finished but no result ID returned')
  })

  it('rejects an execution answer with neither result nor job', async () => {
    const { transport, post } = fakeTransport()
    post.mockResolvedValue({})
    await expect(nodeCalls.executeAdhoc(transport, 4, 'x')).rejects.toThrow('Unexpected response from query execution')
  })

  it('stops polling when the signal aborts', async () => {
    const { transport, get, post } = fakeTransport()
    post.mockResolvedValue({ job: { id: 'j' } })
    get.mockResolvedValue({ job: { status: 2 } })
    const controller = new AbortController()
    const pending = nodeCalls.executeAdhoc(transport, 4, 'x', { signal: controller.signal })
    const settled = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(10)
    controller.abort()
    await settled
  })
})
