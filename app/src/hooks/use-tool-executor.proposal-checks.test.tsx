import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnyToolRequest } from '@/lib/chat/frames'

const postToolResult = vi.hoisted(() => vi.fn())
const get = vi.hoisted(() => vi.fn())

vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  postToolResult,
}))
vi.mock('@/services/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api-client')>()),
  redashApi: { get, post: vi.fn(), delete: vi.fn() },
}))

import { useToolExecutor } from './use-tool-executor'

const KPI_ARGS = {
  name: 'n',
  description: '',
  sourceQueryId: null,
  queryDraftId: 'draft-1',
  valueColumn: 'v',
  unit: null,
  target: 1,
  direction: 'higher-is-better' as const,
  cadence: 'daily' as const,
  atRisk: null,
  breached: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  postToolResult.mockResolvedValue({ accepted: true })
})

describe('community proposal checks run in the browser', () => {
  it('answers a delete_snippet call with the snippet it read', async () => {
    get.mockImplementation(async (path: string) =>
      path === 'session'
        ? { user: { id: 1, permissions: [] } }
        : { id: 3, trigger: 'dt', description: '', snippet: 's', user: { id: 1 }, updated_at: 'u' }
    )
    const request: AnyToolRequest = { callId: 's1', tool: 'delete_snippet', args: { snippetId: 3 } }
    const onResult = vi.fn()
    const { result } = renderHook(() => useToolExecutor())
    result.current.execute('turn', request, onResult)
    await waitFor(() =>
      expect(postToolResult).toHaveBeenCalledWith(
        'turn',
        's1',
        expect.objectContaining({ kind: 'snippet_check', ok: true, mode: 'delete', snippetId: 3 })
      )
    )
    expect(onResult).toHaveBeenCalled()
  })

  it('answers propose_kpi for a query draft from the preview the thread holds', async () => {
    const draftPreview = vi.fn(() => ({ name: 'Trips', columns: ['v'] }))
    const request: AnyToolRequest = { callId: 'k1', tool: 'propose_kpi', args: KPI_ARGS }
    const { result } = renderHook(() => useToolExecutor(draftPreview))
    result.current.execute('turn', request, vi.fn())
    await waitFor(() =>
      expect(postToolResult).toHaveBeenCalledWith('turn', 'k1', {
        kind: 'kpi_check',
        ok: true,
        sourceQueryId: null,
        queryDraftId: 'draft-1',
        queryName: 'Trips',
        columns: ['v'],
      })
    )
    expect(draftPreview).toHaveBeenCalledWith('draft-1')
  })
})
