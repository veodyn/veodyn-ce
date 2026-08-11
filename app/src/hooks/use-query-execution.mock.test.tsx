// Running and formatting a query with no backend, which is what the demo and
// every e2e run execute against.
//
// The mock run has to answer with the fixture rows when the query has some, and
// with something plausible when it does not, because the editor renders the
// result table off whatever comes back. Answering the fixture rows for one
// query and undefined for another is a table that works on the demo path and
// blanks on any other.
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MockQuery, MockQueryResult } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import {
  useCancelQuery,
  useExecuteQuery,
  useFormatQuery,
  useQueryResult,
} from './use-query-execution'

const QUERY_ID = 940
const RESULT_ID = 941
const DATA_SOURCE_ID = 2

const STORED_RESULT = {
  id: RESULT_ID,
  query_hash: 'h',
  query: 'select route, boardings from ridership',
  data: {
    columns: [{ name: 'route', friendly_name: 'route', type: 'string' }],
    rows: [{ route: '720' }],
  },
  data_source_id: DATA_SOURCE_ID,
  runtime: 0.4,
  retrieved_at: '2026-07-15T00:00:00Z',
} as MockQueryResult

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  useMockDataStore.setState({
    queries: [
      { id: QUERY_ID, name: 'Ridership', latest_query_data_id: RESULT_ID } as MockQuery,
      { id: QUERY_ID + 1, name: 'Never run', latest_query_data_id: null } as MockQuery,
    ],
    queryResults: { [RESULT_ID]: STORED_RESULT },
  })
})

describe('running a saved query with no backend', () => {
  it('answers with the rows the fixture holds for that query', async () => {
    const { result } = renderHook(() => useExecuteQuery(), { wrapper })

    const run = await act(async () =>
      result.current.mutateAsync({
        queryId: QUERY_ID,
        queryText: 'select route, boardings from ridership',
        dataSourceId: DATA_SOURCE_ID,
      })
    )

    expect(run.data.rows).toEqual([{ route: '720' }])
    expect(run.id).toBe(RESULT_ID)
  })

  // A query with no fixture rows still has to produce a result table rather
  // than an undefined the editor cannot render.
  it('answers with a generic result for a query nothing was written for', async () => {
    const { result } = renderHook(() => useExecuteQuery(), { wrapper })

    const run = await act(async () =>
      result.current.mutateAsync({
        queryId: QUERY_ID + 1,
        queryText: 'select 1',
        dataSourceId: DATA_SOURCE_ID,
      })
    )

    expect(run.data.rows).toHaveLength(1)
    expect(run.data.columns).toHaveLength(1)
    // Echoed back, so the editor's result header describes the run that
    // happened rather than a fixture from somewhere else.
    expect(run.query).toBe('select 1')
    expect(run.data_source_id).toBe(DATA_SOURCE_ID)
  })

  it('answers generically for an unsaved buffer that has no query id at all', async () => {
    const { result } = renderHook(() => useExecuteQuery(), { wrapper })

    const run = await act(async () =>
      result.current.mutateAsync({ queryText: 'select 2', dataSourceId: DATA_SOURCE_ID })
    )

    expect(run.query).toBe('select 2')
    expect(run.retrieved_at).not.toBe('')
  })
})

describe('cancelling with no backend', () => {
  // Nothing to abort and no job to cancel, but the mutation still has to settle
  // so the Cancel button leaves its pending state.
  it('settles rather than staying pending forever', async () => {
    const { result } = renderHook(() => useCancelQuery(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync()
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

describe('reading a stored result with no backend', () => {
  it('reads the result out of the fixture store', async () => {
    const { result } = renderHook(() => useQueryResult(RESULT_ID), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(STORED_RESULT)
  })

  // Null rather than undefined: the pane distinguishes "no result stored" from
  // "still loading", and undefined is what loading looks like.
  it('answers null for a result id the store does not have', async () => {
    const { result } = renderHook(() => useQueryResult(99999), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })
})

describe('formatting SQL with no backend', () => {
  it('uppercases the keywords and leaves the identifiers alone', async () => {
    const { result } = renderHook(() => useFormatQuery(), { wrapper })

    const formatted = await act(async () =>
      result.current.mutateAsync('select route from ridership where boardings > 10')
    )

    expect(formatted).toBe('SELECT route FROM ridership WHERE boardings > 10')
  })

  it('uppercases a two-word keyword as one', async () => {
    const { result } = renderHook(() => useFormatQuery(), { wrapper })

    const formatted = await act(async () =>
      result.current.mutateAsync('select route from t group by route order by route')
    )

    expect(formatted).toContain('GROUP BY route')
    expect(formatted).toContain('ORDER BY route')
  })

  // Word boundaries, not substrings: an identifier that merely contains a
  // keyword must survive intact, or formatting rewrites column names into SQL
  // that no longer runs.
  it('does not touch an identifier that merely contains a keyword', async () => {
    const { result } = renderHook(() => useFormatQuery(), { wrapper })

    const formatted = await act(async () =>
      result.current.mutateAsync('select as_of, insertion, counted from t')
    )

    expect(formatted).toBe('SELECT as_of, insertion, counted FROM t')
  })
})
