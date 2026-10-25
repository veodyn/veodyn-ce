import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/services/api-client'
import type { ChatToolRequestOf } from './frames'
import { noQueryForKpi, resolveKpiCheck } from './kpi-check'
import type { RedashTransport } from './transport'

const signal = new AbortController().signal

const CALL = {
  name: 'On-time rate',
  description: '',
  sourceQueryId: 12 as number | null,
  queryDraftId: null as string | null,
  valueColumn: 'rate',
  unit: '%',
  target: 90,
  direction: 'higher-is-better' as const,
  cadence: 'daily' as const,
  atRisk: null,
  breached: null,
}

function request(args: Partial<typeof CALL>): ChatToolRequestOf<'propose_kpi'> {
  return { callId: 'c', tool: 'propose_kpi', args: { ...CALL, ...args } }
}

function transportFor(options: { query?: Record<string, unknown> | 'gone' | 'forbidden'; columns?: string[] }) {
  const get = vi.fn(async (path: string) => {
    if (path === 'queries/12') {
      if (options.query === 'gone') throw new ApiError(404, 'x')
      if (options.query === 'forbidden') throw new ApiError(403, 'x')
      return { id: 12, name: 'OTP', is_archived: false, latest_query_data_id: 55, ...options.query }
    }
    if (path === 'query_results/55') {
      return { query_result: { id: 55, data: { columns: (options.columns ?? []).map((name) => ({ name })), rows: [] } } }
    }
    throw new Error(`unexpected ${path}`)
  })
  return { get, post: vi.fn(), del: vi.fn() } as unknown as RedashTransport
}

describe('resolveKpiCheck', () => {
  it('reads the stored result columns of a saved query the user can read', async () => {
    const result = await resolveKpiCheck(request({}), transportFor({ columns: ['day', 'rate'] }), signal)
    expect(result).toEqual({
      kind: 'kpi_check',
      ok: true,
      sourceQueryId: 12,
      queryDraftId: null,
      queryName: 'OTP',
      columns: ['day', 'rate'],
    })
  })

  it('returns no columns for a query that has never run, which the sidecar reads as unknown', async () => {
    const result = await resolveKpiCheck(
      request({}),
      transportFor({ query: { latest_query_data_id: null } }),
      signal
    )
    expect(result).toMatchObject({ ok: true, columns: [] })
  })

  it('fails for a query that is gone, archived or hidden from the user', async () => {
    expect(await resolveKpiCheck(request({}), transportFor({ query: 'gone' }), signal)).toEqual({
      kind: 'kpi_check',
      ok: false,
      error: noQueryForKpi(12),
    })
    expect(await resolveKpiCheck(request({}), transportFor({ query: { is_archived: true } }), signal)).toMatchObject({
      ok: false,
    })
    expect(await resolveKpiCheck(request({}), transportFor({ query: 'forbidden' }), signal)).toMatchObject({ ok: false })
  })

  it('reads a query draft from the preview the thread already holds', async () => {
    const draftPreview = vi.fn(() => ({ name: 'Proposed OTP', columns: ['day', 'rate'] }))
    const result = await resolveKpiCheck(
      request({ sourceQueryId: null, queryDraftId: 'draft-1' }),
      transportFor({}),
      signal,
      draftPreview
    )
    expect(draftPreview).toHaveBeenCalledWith('draft-1')
    expect(result).toEqual({
      kind: 'kpi_check',
      ok: true,
      sourceQueryId: null,
      queryDraftId: 'draft-1',
      queryName: 'Proposed OTP',
      columns: ['day', 'rate'],
    })
  })

  it('does not block a draft that has not run yet', async () => {
    const result = await resolveKpiCheck(
      request({ sourceQueryId: null, queryDraftId: 'draft-1' }),
      transportFor({}),
      signal,
      () => null
    )
    expect(result).toMatchObject({ ok: true, queryDraftId: 'draft-1', columns: [] })
  })
})
