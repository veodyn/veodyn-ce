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

const DASHBOARD = {
  id: 4,
  name: 'Ops',
  tags: [],
  can_edit: true,
  is_archived: false,
  updated_at: 'u',
  widgets: [
    { id: 2, dashboard_id: 4, text: 'Notes', width: 1, options: { position: { col: 0, row: 0, sizeX: 6, sizeY: 4 } }, updated_at: 'w2' },
  ],
}

beforeEach(() => {
  vi.resetAllMocks()
  postToolResult.mockResolvedValue({ accepted: true })
  transport.get.mockImplementation(async (path: string) => {
    if (path === 'dashboards/4') return DASHBOARD
    throw new Error(`unexpected ${path}`)
  })
})

describe('update_dashboard in the browser executor', () => {
  it('resolves the edit on the browser transport and posts the dashboard_edit result', async () => {
    const request: ChatToolRequest = {
      callId: 'u1',
      tool: 'update_dashboard',
      args: { dashboardId: 4, operations: [{ op: 'remove', widgetId: 2 }] },
    }
    const onResult = vi.fn()
    const { result } = renderHook(() => useToolExecutor())
    act(() => result.current.execute('turn', request, onResult))
    await waitFor(() => expect(postToolResult).toHaveBeenCalled())
    expect(postToolResult).toHaveBeenCalledWith(
      'turn',
      'u1',
      expect.objectContaining({
        kind: 'dashboard_edit',
        ok: true,
        dashboardId: 4,
        operations: [expect.objectContaining({ op: 'remove', widgetId: 2, updatedAt: 'w2' })],
      })
    )
    expect(onResult).toHaveBeenCalledWith('u1', expect.objectContaining({ kind: 'dashboard_edit' }))
    expect(transport.post).not.toHaveBeenCalled()
    expect(transport.del).not.toHaveBeenCalled()
  })
})
