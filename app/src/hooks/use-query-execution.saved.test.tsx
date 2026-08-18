/**
 * Which endpoint a run goes to, which is not cosmetic for parameters.
 *
 * The ad hoc endpoint builds `ParameterizedQuery` with no schema
 * (redash/handlers/query_results.py:169), so a multi-value list joins to a bare
 * `Open,Closed`. The saved-query endpoint carries the schema and applies the
 * query's multiValuesOptions server-side, and it validates enums with
 * `_is_value_within_options`, so a client-joined string is rejected outright.
 *
 * The editor stays on the ad hoc path: the buffer it runs may differ from what
 * is saved.
 */
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

import { useExecuteQuery } from './use-query-execution'

const QUERY_ID = 8

const RESULT = {
  id: 55,
  query_hash: 'h',
  query: 'select 1',
  data: { columns: [], rows: [] },
  data_source_id: 1,
  runtime: 0.01,
  retrieved_at: '2026-07-15T00:00:00Z',
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

/** Records whichever execution endpoint gets hit, and the body it received. */
function serveBothEndpoints() {
  const calls: Array<{ path: 'saved' | 'adhoc'; body: Record<string, unknown> }> = []
  server.use(
    http.post(`/api/node/queries/${QUERY_ID}/results`, async ({ request }) => {
      calls.push({ path: 'saved', body: (await request.json()) as Record<string, unknown> })
      return HttpResponse.json({ query_result: RESULT })
    }),
    http.post('/api/node/query_results', async ({ request }) => {
      calls.push({ path: 'adhoc', body: (await request.json()) as Record<string, unknown> })
      return HttpResponse.json({ query_result: RESULT })
    })
  )
  return calls
}

describe('executing a saved query', () => {
  it('sends a multi-value parameter as a list, to the endpoint that has the schema', async () => {
    const calls = serveBothEndpoints()
    const { result } = renderHook(() => useExecuteQuery(), { wrapper })

    await act(async () => {
      result.current.mutate({
        queryId: QUERY_ID,
        queryText: 'select 1',
        dataSourceId: 1,
        savedQuery: true,
        parameters: { status: ['Open', 'Closed'] },
      })
    })
    await waitFor(() => expect(calls).toHaveLength(1))

    expect(calls[0].path).toBe('saved')
    // Still a list. Joined here it would be rejected by _is_value_within_options.
    expect(calls[0].body.parameters).toEqual({ status: ['Open', 'Closed'] })
  })

  // Refresh is an explicit re-run. Omitting max_age means "any cached result is
  // fine", which would make the button return stale rows and look broken.
  it('forces a fresh run rather than accepting a cached result', async () => {
    const calls = serveBothEndpoints()
    const { result } = renderHook(() => useExecuteQuery(), { wrapper })

    await act(async () => {
      result.current.mutate({
        queryId: QUERY_ID,
        queryText: 'select 1',
        dataSourceId: 1,
        savedQuery: true,
      })
    })
    await waitFor(() => expect(calls).toHaveLength(1))

    expect(calls[0].body.max_age).toBe(0)
  })

  it('leaves the editor on the ad hoc endpoint, where the buffer is what runs', async () => {
    const calls = serveBothEndpoints()
    const { result } = renderHook(() => useExecuteQuery(), { wrapper })

    await act(async () => {
      result.current.mutate({
        queryId: QUERY_ID,
        queryText: 'select 2 -- edited, not saved',
        dataSourceId: 1,
        parameters: { route: '12' },
      })
    })
    await waitFor(() => expect(calls).toHaveLength(1))

    expect(calls[0].path).toBe('adhoc')
    expect(calls[0].body.query).toBe('select 2 -- edited, not saved')
  })
})
