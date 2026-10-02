import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureDescriptor } from '@/features/types'
import type { ChatToolRequest } from '@/lib/chat/frames'
import type { ChatToolResult } from '@/lib/chat/tool-results'

const KPI: ChatToolResult = { kind: 'kpi', ok: true, kpi: { id: 'otp-weekly', name: 'On-time performance' } }
const runner = vi.hoisted(() => vi.fn())
const postToolResult = vi.hoisted(() => vi.fn())

vi.mock('@/features/generated-registry', () => {
  const FEATURES: Record<string, FeatureDescriptor> = {
    kpis: {
      id: 'kpis',
      nav: [],
      routes: [],
      chatTools: [
        { tool: 'show_kpi', execute: async () => ({ default: runner }), card: async () => ({ default: () => null }) },
      ],
    },
  }
  return { FEATURES }
})
vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  postToolResult,
}))

import { NO_CONTRIBUTOR_MESSAGE } from '@/features/chat-tools'
import { useToolExecutor } from './use-tool-executor'

const SHOW: ChatToolRequest = { callId: 'k1', tool: 'show_kpi', args: { kpiId: 'otp-weekly' } }
const LIST: ChatToolRequest = { callId: 'k2', tool: 'list_kpis', args: {} }

beforeEach(() => {
  vi.clearAllMocks()
  postToolResult.mockResolvedValue({ accepted: true })
})

describe('a contributed chat tool', () => {
  it('is run by the feature that contributed it, shown, and posted back', async () => {
    runner.mockResolvedValue(KPI)
    const onResult = vi.fn()
    const { result } = renderHook(() => useToolExecutor())
    result.current.execute('turn', SHOW, onResult)
    await waitFor(() => expect(postToolResult).toHaveBeenCalledWith('turn', 'k1', KPI))
    expect(runner).toHaveBeenCalledWith({ kpiId: 'otp-weekly' }, expect.any(AbortSignal))
    expect(onResult).toHaveBeenCalledWith('k1', KPI)
  })

  it('runs once for a request delivered twice', async () => {
    runner.mockResolvedValue(KPI)
    const { result } = renderHook(() => useToolExecutor())
    result.current.execute('turn', SHOW, vi.fn())
    result.current.execute('turn', SHOW, vi.fn())
    await waitFor(() => expect(postToolResult).toHaveBeenCalled())
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('posts a failure when the feature throws, so the turn is not left waiting', async () => {
    runner.mockRejectedValue(new Error('kpi backend unreachable'))
    const onResult = vi.fn()
    const { result } = renderHook(() => useToolExecutor())
    result.current.execute('turn', SHOW, onResult)
    const failed = { kind: 'kpi', ok: false, error: 'kpi backend unreachable' }
    await waitFor(() => expect(postToolResult).toHaveBeenCalledWith('turn', 'k1', failed))
    expect(onResult).toHaveBeenCalledWith('k1', failed)
  })

  it('posts nothing once the conversation is gone', async () => {
    let finish: (value: ChatToolResult) => void = () => undefined
    runner.mockImplementation(
      (_args: unknown, signal: AbortSignal) =>
        new Promise<ChatToolResult>((resolve, reject) => {
          finish = resolve
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
    )
    const { result, unmount } = renderHook(() => useToolExecutor())
    result.current.execute('turn', SHOW, vi.fn())
    await waitFor(() => expect(runner).toHaveBeenCalled())
    unmount()
    finish(KPI)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(postToolResult).not.toHaveBeenCalled()
  })

  it('answers at once for a tool no installed feature can run', async () => {
    const onResult = vi.fn()
    const { result } = renderHook(() => useToolExecutor())
    result.current.execute('turn', LIST, onResult)
    const failed = { kind: 'kpi_list', ok: false, error: NO_CONTRIBUTOR_MESSAGE }
    await waitFor(() => expect(postToolResult).toHaveBeenCalledWith('turn', 'k2', failed))
    expect(onResult).toHaveBeenCalledWith('k2', failed)
  })
})
