// Reading a stored result, and formatting SQL, against a real backend.
//
// useQueryResult is the read behind "here are the rows from the last run". It
// is fetched by id, and the id is frequently absent: a query that has never
// run, or a page rendering before the execution answered. Absent has to stay
// distinct from failed, because the two want opposite things on screen ("run
// this to see rows" versus "the backend refused").
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))
vi.mock('@/services/redash/execution', () => ({
  executeSavedQuery: vi.fn(),
  executeAdhoc: vi.fn(),
  getResult: vi.fn(),
  formatQuery: vi.fn(),
}))
vi.mock('@/services/redash/jobs', () => ({ cancelJob: vi.fn(), pollJob: vi.fn() }))

import * as execution from '@/services/redash/execution'
import { useFormatQuery, useQueryResult } from './use-query-execution'

const RESULT_ID = 55

const RESULT = {
  id: RESULT_ID,
  query_hash: 'h',
  query: 'select 1',
  data: {
    columns: [{ name: 'route', friendly_name: 'route', type: 'string' }],
    rows: [{ route: '720' }],
  },
  data_source_id: 1,
  runtime: 0.01,
  retrieved_at: '2026-07-15T00:00:00Z',
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

function renderResult(id: number | null | undefined) {
  return renderHook(() => useQueryResult(id), { wrapper })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(execution.getResult).mockResolvedValue(RESULT)
})

describe('reading a stored result', () => {
  it('fetches the result by id and hands back its rows', async () => {
    const { result } = renderResult(RESULT_ID)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(vi.mocked(execution.getResult)).toHaveBeenCalledWith(RESULT_ID)
    expect(result.current.data?.data.rows).toEqual([{ route: '720' }])
  })

  // The bug this rejects: a refused read rendering the same "no rows yet" panel
  // as a query that has never been run, so a backend that is down reads as a
  // query that returned nothing.
  it('surfaces a refused read as an error, not as an absent result', async () => {
    vi.mocked(execution.getResult).mockRejectedValue(new Error('403 no access to this result'))
    const { result } = renderResult(RESULT_ID)

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  // Disabled, not resolved-with-null: a settled query carrying null is a cache
  // entry that says "this ran and there is nothing", which is the answer the
  // hook must not give for a query nobody has run.
  it('does not fetch anything for a query that has never run', async () => {
    const { result } = renderResult(null)

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'))
    expect(result.current.status).toBe('pending')
    expect(result.current.isError).toBe(false)
    expect(vi.mocked(execution.getResult)).not.toHaveBeenCalled()
  })

  it('does not fetch anything before the id has arrived', async () => {
    const { result } = renderResult(undefined)

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'))
    expect(result.current.status).toBe('pending')
    expect(vi.mocked(execution.getResult)).not.toHaveBeenCalled()
  })

  // Result ids are per-run: two runs of the same query hold different rows, so
  // one cache entry for both would show the previous run's data.
  it('keeps one cache entry per result id', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(
      () => ({ first: useQueryResult(55), second: useQueryResult(56) }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={qc}>{children}</QueryClientProvider>
        ),
      }
    )

    await waitFor(() => {
      expect(result.current.first.isSuccess).toBe(true)
      expect(result.current.second.isSuccess).toBe(true)
    })
    expect(vi.mocked(execution.getResult).mock.calls.map((c) => c[0])).toEqual([55, 56])
  })
})

describe('formatting SQL', () => {
  it('returns what the backend formatted rather than the text it was given', async () => {
    vi.mocked(execution.formatQuery).mockResolvedValue('SELECT\n  1')
    const { result } = renderHook(() => useFormatQuery(), { wrapper })

    const formatted = await act(async () => result.current.mutateAsync('select 1'))

    expect(vi.mocked(execution.formatQuery)).toHaveBeenCalledWith('select 1')
    expect(formatted).toBe('SELECT\n  1')
  })

  // Redash answers 400 on SQL it cannot parse. Swallowing that and returning
  // the original text would look like a formatter that silently does nothing.
  it('reports a refusal instead of quietly returning the original text', async () => {
    vi.mocked(execution.formatQuery).mockRejectedValue(new Error('400 could not parse'))
    const { result } = renderHook(() => useFormatQuery(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('slect 1').catch(() => {})
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })
})
