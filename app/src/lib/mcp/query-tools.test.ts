// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CREDENTIAL,
  fakeClock,
  json,
  loadQueryTools,
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

describe('list_queries', () => {
  it('summarises each query and reports whether it is scheduled', async () => {
    mockFetchSequence([
      json({
        count: 1,
        results: [
          {
            id: 7,
            name: 'Rail ridership',
            description: 'daily',
            schedule: { interval: 3600 },
            updated_at: '2026-02-18T00:00:00Z',
          },
        ],
      }),
    ])
    const { listQueries } = await loadQueryTools()

    expect(await listQueries({}, CREDENTIAL)).toEqual({
      count: 1,
      queries: [
        {
          id: 7,
          name: 'Rail ridership',
          description: 'daily',
          scheduled: true,
          updated_at: '2026-02-18T00:00:00Z',
        },
      ],
    })
  })

  it('caps the page size a model asks for', async () => {
    const spy = mockFetchSequence([json({ count: 0, results: [] })])
    const { listQueries } = await loadQueryTools()

    await listQueries({ page_size: 100000 }, CREDENTIAL)

    expect(String(spy.mock.calls[0][0])).toContain('page_size=100')
  })

  it('passes a search term through', async () => {
    const spy = mockFetchSequence([json({ count: 0, results: [] })])
    const { listQueries } = await loadQueryTools()

    await listQueries({ search: ' rail ' }, CREDENTIAL)

    expect(String(spy.mock.calls[0][0])).toContain('q=rail')
  })
})

describe('get_query', () => {
  it('says the SQL is not visible rather than showing an empty query', async () => {
    // Redash omits `query` when the caller lacks view_source. An empty string
    // would read as "this query has no SQL", which is a different claim.
    mockFetchSequence([json({ id: 7, name: 'Rail', description: null, options: {} })])
    const { getQuery } = await loadQueryTools()

    const result = await getQuery({ query_id: 7 }, CREDENTIAL)

    expect(result.sql).toBe('(not visible to this credential)')
  })

  it('refuses an id that is not an integer', async () => {
    const { getQuery } = await loadQueryTools()

    await expect(getQuery({ query_id: 'seven' }, CREDENTIAL)).rejects.toThrow(TypeError)
  })
})

describe('run_query', () => {
  const finished = {
    id: 55,
    data: { columns: [{ name: 'n', type: 'integer' }], rows: [{ n: 1 }] },
    retrieved_at: '2026-02-18T00:00:00Z',
    runtime: 0.5,
  }

  it('returns a cached result without polling anything', async () => {
    const spy = mockFetchSequence([json({ query_result: finished })])
    const { runQuery } = await loadQueryTools()

    const result = await runQuery({ query_id: 7 }, CREDENTIAL, fakeClock())

    expect(result.row_count).toBe(1)
    expect(result.rows).toEqual([{ n: 1 }])
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('polls a job to completion and then reads the result it points at', async () => {
    mockFetchSequence([
      json({ job: { id: 'j1', status: 1 } }),
      json({ job: { id: 'j1', status: 2 } }),
      json({ job: { id: 'j1', status: 3, query_result_id: 55 } }),
      json({ query_result: finished }),
    ])
    const { runQuery } = await loadQueryTools()

    const result = await runQuery({ query_id: 7 }, CREDENTIAL, fakeClock())

    expect(result.rows).toEqual([{ n: 1 }])
  })

  it('surfaces the reason a job failed', async () => {
    mockFetchSequence([json({ job: { id: 'j1', status: 4, error: 'relation does not exist' } })])
    const { runQuery } = await loadQueryTools()

    await expect(runQuery({ query_id: 7 }, CREDENTIAL, fakeClock())).rejects.toThrow(
      /relation does not exist/
    )
  })

  it('gives up on a query that never finishes, instead of holding the request open', async () => {
    // A fresh Response per call: a body can only be read once, and reusing one
    // object fails with "Body has already been read" long before the timeout.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json({ job: { id: 'j1', status: 1 } })
    )
    const { runQuery, POLL_TIMEOUT_MS } = await loadQueryTools()

    await expect(runQuery({ query_id: 7 }, CREDENTIAL, fakeClock())).rejects.toThrow(
      new RegExp(`still running after ${POLL_TIMEOUT_MS / 1000}s`)
    )
  })

  it('sends max_age and parameters only when they were given', async () => {
    const spy = mockFetchSequence([json({ query_result: finished })])
    const { runQuery } = await loadQueryTools()

    await runQuery({ query_id: 7, max_age: 0, parameters: { station: 'A' } }, CREDENTIAL, fakeClock())

    expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toEqual({
      parameters: { station: 'A' },
      max_age: 0,
    })
  })

  it('sends an empty body when neither was given, so the cache decides', async () => {
    const spy = mockFetchSequence([json({ query_result: finished })])
    const { runQuery } = await loadQueryTools()

    await runQuery({ query_id: 7 }, CREDENTIAL, fakeClock())

    expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toEqual({})
  })

  it('caps the rows it returns, and says the answer is partial', async () => {
    // A saved query can return a million rows; the whole result would be
    // serialised into one JSON-RPC response for a model that cannot read it.
    const { MAX_RESULT_ROWS } = await loadQueryTools()
    const rows = Array.from({ length: MAX_RESULT_ROWS + 500 }, (_, i) => ({ n: i }))
    mockFetchSequence([json({ query_result: { ...finished, data: { ...finished.data, rows } } })])
    const { runQuery } = await loadQueryTools()

    const result = await runQuery({ query_id: 7 }, CREDENTIAL, fakeClock())

    expect(result.rows).toHaveLength(MAX_RESULT_ROWS)
    expect(result.total_row_count).toBe(MAX_RESULT_ROWS + 500)
    expect(result.note).toMatch(/Truncated/)
  })

  it('adds no truncation note when nothing was cut', async () => {
    mockFetchSequence([json({ query_result: finished })])
    const { runQuery } = await loadQueryTools()

    const result = await runQuery({ query_id: 7 }, CREDENTIAL, fakeClock())

    expect(result.note).toBeUndefined()
    expect(result.total_row_count).toBe(1)
  })

  it('stops polling when the client hangs up', async () => {
    const controller = new AbortController()
    controller.abort()
    mockFetchSequence([json({ job: { id: 'j1', status: 1 } })])
    const { runQuery } = await loadQueryTools()

    await expect(
      runQuery({ query_id: 7 }, CREDENTIAL, fakeClock(), controller.signal)
    ).rejects.toThrow(/client hung up/)
  })

  it('says so when Redash answers with neither a result nor a job', async () => {
    mockFetchSequence([json({})])
    const { runQuery } = await loadQueryTools()

    await expect(runQuery({ query_id: 7 }, CREDENTIAL, fakeClock())).rejects.toThrow(
      /neither a result nor a job/
    )
  })
})
