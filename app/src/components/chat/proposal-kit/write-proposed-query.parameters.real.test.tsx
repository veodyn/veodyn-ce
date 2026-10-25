import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { NewQueryProposal } from '@/types/proposal-kit'
import { executeSavedQuery } from '@/services/redash/execution'
import { useWriteProposedQuery } from './use-write-proposed-query'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))
vi.mock('@/services/redash/execution', () => ({
  executeSavedQuery: vi.fn().mockResolvedValue({ data: { columns: [], rows: [] } }),
}))

const sent = vi.hoisted(() => ({
  queries: [] as Record<string, unknown>[],
  visualizations: [] as Record<string, unknown>[],
  failVisualization: false,
}))

vi.mock('@/hooks/use-queries', () => ({
  useCreateQuery: () => ({
    mutateAsync: async (vars: Record<string, unknown>) => {
      sent.queries.push(vars)
      return { id: 77, name: 'Q', visualizations: [{ id: 700, type: 'TABLE' }] }
    },
    isPending: false,
  }),
}))
vi.mock('@/hooks/use-query-mutations', () => ({
  useArchiveQuery: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/use-visualizations', () => ({
  useUpdateVisualization: () => ({ mutateAsync: async () => undefined, isPending: false }),
  useCreateVisualization: () => ({
    mutateAsync: async (vars: Record<string, unknown>) => {
      if (sent.failVisualization) throw new Error('viz refused')
      sent.visualizations.push(vars)
      return { id: 701 }
    },
    isPending: false,
  }),
}))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const PROPOSAL: NewQueryProposal = {
  name: 'Trips',
  description: '',
  sql: 'select {{ day }}',
  vizChoiceId: 'table',
  vizOptions: {},
}

beforeEach(() => {
  sent.queries = []
  sent.visualizations = []
  sent.failVisualization = false
  vi.mocked(executeSavedQuery).mockClear()
})

describe('write() with parameters and idempotency keys', () => {
  it('Save sends native parameter definitions', async () => {
    const { result } = renderHook(() => useWriteProposedQuery(), { wrapper })
    await result.current.write(
      {
        ...PROPOSAL,
        parameters: [
          { name: 'day', type: 'enum', enumOptions: 'a\nb', multi: true, quote: 'single' },
          { name: 'since', type: 'date', title: 'Since' },
        ],
      },
      1
    )
    expect(sent.queries[0].options).toEqual({
      parameters: [
        { name: 'day', type: 'enum', enumOptions: 'a\nb', multiValuesOptions: { prefix: "'", suffix: "'", separator: ',' } },
        { name: 'since', type: 'date', title: 'Since' },
      ],
    })
  })

  it('runs the new query with each parameter default, skipping parameters that have none', async () => {
    const { result } = renderHook(() => useWriteProposedQuery(), { wrapper })
    const range = { start: '2026-10-01', end: '2026-10-31' }
    await result.current.write(
      {
        ...PROPOSAL,
        parameters: [
          { name: 'limit', type: 'number', value: 10 },
          { name: 'period', type: 'date-range', value: range },
          { name: 'city', type: 'text' },
        ],
      },
      1
    )
    expect(executeSavedQuery).toHaveBeenCalledWith(77, { maxAge: 0, parameters: { limit: 10, period: range } })
  })

  it('runs a parameterless query with no parameters', async () => {
    const { result } = renderHook(() => useWriteProposedQuery(), { wrapper })
    await result.current.write(PROPOSAL, 1)
    expect(executeSavedQuery).toHaveBeenCalledWith(77, { maxAge: 0 })
  })

  it('sends no options when the proposal has no parameters', async () => {
    const { result } = renderHook(() => useWriteProposedQuery(), { wrapper })
    await result.current.write(PROPOSAL, 1)
    expect('options' in sent.queries[0]).toBe(false)
  })

  it('reports the created query before the visualization is written, even when that fails', async () => {
    const { result } = renderHook(() => useWriteProposedQuery(), { wrapper })
    sent.failVisualization = true
    const created: number[] = []
    await expect(
      result.current.write({ ...PROPOSAL, vizChoiceId: 'chart-bar' }, 1, { onCreated: (id) => created.push(id) })
    ).rejects.toThrow('viz refused')
    expect(created).toEqual([77])
  })

  it('sends the idempotency key on the query and on its visualization', async () => {
    const { result } = renderHook(() => useWriteProposedQuery(), { wrapper })
    await result.current.write({ ...PROPOSAL, vizChoiceId: 'chart-bar' }, 1, {
      idempotencyKeys: { query: 'd:1:0', visualization: 'd:1:1' },
    })
    expect(sent.queries[0].idempotency_key).toBe('d:1:0')
    expect(sent.visualizations[0].idempotencyKey).toBe('d:1:1')
  })
})
