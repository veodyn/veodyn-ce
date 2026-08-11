// Real-API coverage for the schema browser's table preview. USE_REAL_API is a
// module-level constant, so it is forced true for the whole file via vi.mock,
// the pattern the other real-mode suites here use. What matters is the SQL that
// reaches the warehouse: a bounded read of the table that was clicked.
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useTablePreview } from './use-table-preview'
import * as execution from '@/services/redash/execution'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))
vi.mock('@/services/redash/execution', () => ({ executeAdhoc: vi.fn() }))

const executeAdhoc = vi.mocked(execution.executeAdhoc)

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const RESULT = {
  id: 7,
  query_hash: 'h',
  query: '',
  data: { columns: [{ name: 'lat', friendly_name: 'lat', type: 'float' }], rows: [{ lat: 10.05 }] },
  data_source_id: 1,
  runtime: 0.31,
  retrieved_at: '2026-07-27T00:00:00Z',
}

function preview(overrides: Partial<Parameters<typeof useTablePreview>[0]> = {}) {
  return renderHook(
    () =>
      useTablePreview({
        dataSourceId: 3,
        table: 'historical.stations',
        columns: [{ name: 'lat', type: 'Float64' }],
        enabled: true,
        ...overrides,
      }),
    { wrapper }
  )
}

describe('useTablePreview (real API)', () => {
  beforeEach(() => {
    executeAdhoc.mockReset()
    executeAdhoc.mockResolvedValue(RESULT)
  })

  it('reads a bounded sample of the table from its data source', async () => {
    const { result } = preview()

    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data).toEqual({ data: RESULT.data, runtime: 0.31 })

    const [dataSourceId, sql] = executeAdhoc.mock.calls[0]
    expect(dataSourceId).toBe(3)
    expect(sql).toBe('SELECT *\nFROM historical.stations\nLIMIT 10')
  })

  it('aborts the signal of a read still in flight when the dialog goes away', async () => {
    // Never resolves: the point is what happens to a peek that outlives the
    // dialog that asked for it. What the abort then reaches is the execution
    // layer's business, covered in services/redash/execution.signal.test.ts;
    // here it is that the signal is passed down at all and that it fires.
    executeAdhoc.mockReturnValue(new Promise(() => {}))
    const { unmount } = preview()
    await waitFor(() => expect(executeAdhoc).toHaveBeenCalled())

    const signal = executeAdhoc.mock.calls[0][2]?.signal
    expect(signal?.aborted).toBe(false)
    unmount()
    await waitFor(() => expect(signal?.aborted).toBe(true))
  })

  it('refuses a table name it cannot write unquoted, without calling out', async () => {
    const { result } = preview({ table: 'trips; DROP TABLE users --' })

    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(String(result.current.error)).toMatch(/unsafe SQL identifier/i)
    expect(executeAdhoc).not.toHaveBeenCalled()
  })

  it('does not touch the warehouse until a table is open', () => {
    preview({ enabled: false })
    expect(executeAdhoc).not.toHaveBeenCalled()
  })

  it('surfaces what the data source said', async () => {
    executeAdhoc.mockRejectedValue(new Error('Code: 60. DB::Exception: Unknown table'))
    const { result } = preview()

    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(String(result.current.error)).toContain('Unknown table')
    // One failed peek, one execution: a preview must not queue retries on a
    // warehouse.
    expect(executeAdhoc).toHaveBeenCalledTimes(1)
  })
})
