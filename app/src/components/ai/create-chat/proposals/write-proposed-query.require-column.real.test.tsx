// What `requireColumn` changes, which is only visible against a real backend.
//
// The two callers of write() want opposite things from a failed run. A dashboard
// panel that will not run still shows Refresh, so widget-queries.real.test.tsx
// asserts the panel is kept and nothing is reported. A KPI over a query that will
// not run is a number that does not exist, and one naming a column the SQL does
// not produce reports an error on every evaluation forever.
//
// The column check exists because two separate model calls pick the two names:
// the conversation names `valueColumn`, then a second generation writes the SQL
// and chooses its own aliases. Nothing upstream makes them agree.
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as execution from '@/services/redash/execution'
import { ErrorIds, isAppError } from '@/lib/errorIds'
import type { NewQueryProposal } from '@/types/ai-create'
import { useWriteProposedQuery } from './use-write-proposed-query'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))
vi.mock('@/services/redash/execution', () => ({ executeSavedQuery: vi.fn() }))

const created = vi.hoisted(() => ({ queries: [] as { name: string }[], archived: [] as number[] }))

vi.mock('@/hooks/use-queries', () => ({
  useCreateQuery: () => ({
    mutateAsync: async (vars: { name: string }) => {
      created.queries.push(vars)
      return { id: 77, name: vars.name, visualizations: [{ id: 700, type: 'TABLE' }] }
    },
    isPending: false,
  }),
}))
vi.mock('@/hooks/use-query-mutations', () => ({
  useArchiveQuery: () => ({
    mutateAsync: async (id: number) => {
      created.archived.push(id)
    },
    isPending: false,
  }),
}))
vi.mock('@/hooks/use-visualizations', () => ({
  useCreateVisualization: () => ({ mutateAsync: async () => ({ id: 701 }), isPending: false }),
}))

const executeSavedQuery = vi.mocked(execution.executeSavedQuery)

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const PROPOSAL: NewQueryProposal = {
  name: 'Average bikes free per hour',
  description: '',
  sql: 'SELECT toStartOfHour(captured_at) AS hour, avg(bikes_free) AS avg_free FROM stations GROUP BY hour',
  datasetTable: 'stations',
  vizChoiceId: 'table',
  vizOptions: {},
}

function resultWith(...columns: string[]) {
  return {
    data: {
      columns: columns.map((name) => ({ name, friendly_name: name, type: 'float' })),
      rows: [Object.fromEntries(columns.map((name) => [name, 1]))],
    },
  }
}

beforeEach(() => {
  created.queries = []
  created.archived = []
  executeSavedQuery.mockReset()
  executeSavedQuery.mockResolvedValue(resultWith('hour', 'avg_free') as never)
})

describe('write() with a required column', () => {
  it('returns the query when the run produced the column', async () => {
    const { result } = renderHook(() => useWriteProposedQuery(), { wrapper })

    const written = await result.current.write(PROPOSAL, 1, { requireColumn: 'avg_free' })

    expect(written.queryId).toBe(77)
    expect(executeSavedQuery).toHaveBeenCalledWith(77, { maxAge: 0 })
    expect(created.archived).toEqual([])
  })

  it('refuses when the query will not run, instead of reporting success', async () => {
    executeSavedQuery.mockRejectedValue(new Error('Unknown identifier: bikes_fre'))
    const { result } = renderHook(() => useWriteProposedQuery(), { wrapper })

    // Not swallowed. The KPI card turns this into the message beside the
    // proposal, so the analyst sees it while the SQL is still fixable rather
    // than at the first evaluation of a KPI that was created anyway.
    const thrown = await result.current
      .write(PROPOSAL, 1, { requireColumn: 'avg_free' })
      .catch((cause: unknown) => cause)

    expect(isAppError(thrown) && thrown.id).toBe(ErrorIds.AI_WRITTEN_QUERY_UNRUNNABLE)
    // And the query it had already written is put back. A refusal that leaves
    // the query behind is how one rejected "Create KPI + query" left query 81
    // in the library under the name of a KPI that never existed.
    expect(created.archived).toEqual([77])
    expect(thrown instanceof Error && thrown.message).toContain('nothing was created')
  })

  it('refuses when the run produced a different column name', async () => {
    // The alias drift this exists for: the conversation said `avg_free`, the SQL
    // generation aliased it `average_free`. Both are plausible and nothing
    // upstream reconciles them.
    executeSavedQuery.mockResolvedValue(resultWith('hour', 'average_free') as never)
    const { result } = renderHook(() => useWriteProposedQuery(), { wrapper })

    const thrown = await result.current
      .write(PROPOSAL, 1, { requireColumn: 'avg_free' })
      .catch((cause: unknown) => cause)

    expect(isAppError(thrown) && thrown.id).toBe(ErrorIds.AI_WRITTEN_QUERY_COLUMN_MISSING)
    // The message names what the query DOES return, because that is the column
    // the analyst is about to retype into the field.
    expect(thrown instanceof Error && thrown.message).toContain('average_free')
    expect(created.archived).toEqual([77])
  })

  it('leaves a caller that named no column alone when the run fails', async () => {
    // The dashboard's contract, asserted here too so the two branches of one
    // function cannot drift: the panel exists, and Refresh is on it.
    executeSavedQuery.mockRejectedValue(new Error('warehouse busy'))
    const { result } = renderHook(() => useWriteProposedQuery(), { wrapper })

    const written = await result.current.write(PROPOSAL, 1)

    expect(written.queryId).toBe(77)
    // Nothing was refused, so nothing is put back.
    expect(created.archived).toEqual([])
  })
})
