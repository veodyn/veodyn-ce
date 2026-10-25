import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { NewQueryProposal } from '@/types/proposal-kit'
import { useWriteProposedQuery } from './use-write-proposed-query'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))
vi.mock('@/services/redash/execution', () => ({
  executeSavedQuery: vi.fn().mockResolvedValue({ data: { columns: [], rows: [] } }),
}))

const sent = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
}))

vi.mock('@/hooks/use-queries', () => ({
  useCreateQuery: () => ({
    mutateAsync: async () => ({
      id: 77,
      name: 'Q',
      visualizations: [{ id: 700, type: 'TABLE', name: 'Table', options: { existing: true } }],
    }),
    isPending: false,
  }),
}))
vi.mock('@/hooks/use-query-mutations', () => ({
  useArchiveQuery: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/use-visualizations', () => ({
  useCreateVisualization: () => ({
    mutateAsync: async (vars: Record<string, unknown>) => {
      sent.created.push(vars)
      return { id: 701 }
    },
    isPending: false,
  }),
  useUpdateVisualization: () => ({
    mutateAsync: async (vars: Record<string, unknown>) => {
      sent.updated.push(vars)
      return { id: 700 }
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
  sql: 'select 1',
  vizChoiceId: 'table',
  vizOptions: {},
}

beforeEach(() => {
  sent.created = []
  sent.updated = []
})

describe('write() with authored visualization options', () => {
  it('sanitizes the options through the type declaration before creating the chart', async () => {
    const { result } = renderHook(() => useWriteProposedQuery(), { wrapper })
    await result.current.write(
      { ...PROPOSAL, vizChoiceId: 'chart-bar', vizOptions: { legend: true, bogus: 1, showDataLabels: true } },
      1
    )
    const options = sent.created[0].options as Record<string, unknown>
    expect(options).toMatchObject({ globalSeriesType: 'bar', showDataLabels: true })
    expect(options).not.toHaveProperty('bogus')
  })

  it('writes options onto the table visualization every query starts with', async () => {
    const { result } = renderHook(() => useWriteProposedQuery(), { wrapper })
    const columns = [{ name: 'day', title: 'Day' }]
    const written = await result.current.write({ ...PROPOSAL, vizOptions: { columns, bogus: 1 } }, 1)
    expect(sent.created).toEqual([])
    expect(sent.updated).toHaveLength(1)
    expect(sent.updated[0]).toMatchObject({ queryId: 77, vizId: 700 })
    expect(sent.updated[0].options).toEqual({ existing: true, columns })
    expect(written.visualizationId).toBe(700)
    expect(written.visualization.options).toEqual({ existing: true, columns })
  })

  it('leaves the table visualization alone when the proposal carries no options', async () => {
    const { result } = renderHook(() => useWriteProposedQuery(), { wrapper })
    const written = await result.current.write(PROPOSAL, 1)
    expect(sent.updated).toEqual([])
    expect(written.visualization.options).toEqual({})
  })
})
