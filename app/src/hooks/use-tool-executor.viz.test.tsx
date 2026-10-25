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

const QUERY = {
  id: 5,
  is_archived: false,
  can_edit: true,
  latest_query_data_id: 90,
  visualizations: [
    { id: 10, type: 'TABLE', name: 'Table', options: {}, updated_at: 'u1' },
    { id: 11, type: 'CHART', name: 'Bars', options: { globalSeriesType: 'bar' }, updated_at: 'u2' },
  ],
}

beforeEach(() => {
  vi.resetAllMocks()
  postToolResult.mockResolvedValue({ accepted: true })
  transport.get.mockImplementation(async (path: string) => {
    if (path === 'queries/5') return QUERY
    if (path === 'query_results/90') return { query_result: { data: { columns: [{ name: 'day' }], rows: [] } } }
    throw new Error(`unexpected ${path}`)
  })
})

describe('visualization tools in the browser executor', () => {
  it('answers describe_visualization_type without a request to node', async () => {
    const request: ChatToolRequest = { callId: 'v1', tool: 'describe_visualization_type', args: { type: 'CHART' } }
    const onResult = vi.fn()
    const { result } = renderHook(() => useToolExecutor())
    act(() => result.current.execute('turn', request, onResult))
    await waitFor(() => expect(postToolResult).toHaveBeenCalled())
    expect(postToolResult).toHaveBeenCalledWith('turn', 'v1', expect.objectContaining({ kind: 'visualization_type', ok: true }))
    expect(onResult).toHaveBeenCalledWith('v1', expect.objectContaining({ kind: 'visualization_type' }))
    expect(transport.get).not.toHaveBeenCalled()
  })

  it('resolves delete_visualization on the browser transport and refuses the table', async () => {
    const { result } = renderHook(() => useToolExecutor())
    act(() => result.current.execute('turn', { callId: 'v2', tool: 'delete_visualization', args: { queryId: 5, visualizationId: 10 } }, vi.fn()))
    await waitFor(() => expect(postToolResult).toHaveBeenCalled())
    expect(postToolResult).toHaveBeenCalledWith('turn', 'v2', {
      kind: 'visualization_check',
      ok: false,
      error: 'The table visualization cannot be deleted.',
    })
  })

  it('resolves propose_visualization with the column check', async () => {
    const request: ChatToolRequest = {
      callId: 'v3',
      tool: 'propose_visualization',
      args: { queryId: 5, type: 'CHART', name: 'x', options: { columnMapping: { nope: 'y' } } },
    }
    const { result } = renderHook(() => useToolExecutor())
    act(() => result.current.execute('turn', request, vi.fn()))
    await waitFor(() => expect(postToolResult).toHaveBeenCalled())
    expect(postToolResult).toHaveBeenCalledWith(
      'turn',
      'v3',
      expect.objectContaining({ kind: 'visualization_check', ok: true, problems: expect.arrayContaining(['columnMapping: no column named nope']) })
    )
  })

  it('refuses an update to a type that does not exist', async () => {
    const request: ChatToolRequest = { callId: 'v4', tool: 'update_visualization', args: { queryId: 5, visualizationId: 11, type: 'pie' } }
    const { result } = renderHook(() => useToolExecutor())
    act(() => result.current.execute('turn', request, vi.fn()))
    await waitFor(() => expect(postToolResult).toHaveBeenCalled())
    expect(postToolResult).toHaveBeenCalledWith(
      'turn',
      'v4',
      expect.objectContaining({ kind: 'visualization_check', ok: false, error: expect.stringContaining('No visualization type "pie"') })
    )
  })
})
