import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatToolRequest } from '@/lib/chat/frames'

const postToolResult = vi.hoisted(() => vi.fn())
const transport = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }))

vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  postToolResult,
}))
vi.mock('@/lib/chat/transport', () => ({ browserTransport: transport }))

import { useToolExecutor } from './use-tool-executor'

const QUERY = { id: 7, name: 'Weekly revenue', is_archived: false, user: { id: 4 }, updated_at: 'u', latest_query_data_id: 90 }

beforeEach(() => {
  vi.resetAllMocks()
  postToolResult.mockResolvedValue({ accepted: true })
  transport.get.mockImplementation(async (path: string) => {
    if (path === 'session') return { user: { id: 4, permissions: [] } }
    if (path === 'queries/7') return QUERY
    throw new Error(`unexpected ${path}`)
  })
})

describe('operation tools in the browser executor', () => {
  it('resolves an archive in the browser and posts the check', async () => {
    const request: ChatToolRequest = { callId: 'o1', tool: 'archive_query', args: { queryId: 7, restore: false } }
    const onResult = vi.fn()
    const { result } = renderHook(() => useToolExecutor())
    act(() => result.current.execute('turn', request, onResult))
    await waitFor(() => expect(postToolResult).toHaveBeenCalled())
    expect(postToolResult).toHaveBeenCalledWith(
      'turn',
      'o1',
      expect.objectContaining({ kind: 'operation_check', ok: true, op: 'archive', destructive: true })
    )
    expect(onResult).toHaveBeenCalledWith('o1', expect.objectContaining({ kind: 'operation_check' }))
  })

  it('hands a download link', async () => {
    const request: ChatToolRequest = { callId: 'o2', tool: 'download_result', args: { queryId: 7, format: 'csv' } }
    const { result } = renderHook(() => useToolExecutor())
    act(() => result.current.execute('turn', request, vi.fn()))
    await waitFor(() => expect(postToolResult).toHaveBeenCalled())
    expect(postToolResult).toHaveBeenCalledWith('turn', 'o2', {
      kind: 'download',
      ok: true,
      queryId: 7,
      format: 'csv',
      href: '/api/node/queries/7/results.csv',
    })
  })
})
