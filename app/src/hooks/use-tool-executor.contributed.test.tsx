import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureDescriptor } from '@/features/types'
import type { AnyToolRequest, ChatToolRequest } from '@/lib/chat/frames'
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
        { tool: 'update_kpi', resultKind: 'kpi_edit_check', execute: async () => ({ default: runner }) },
      ],
    },
  }
  return { FEATURES }
})
vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  postToolResult,
}))

import { noContributorMessage } from '@/features/chat-tools'
import { browserSidecarTransport } from '@/lib/chat/sidecar-transport'
import { browserTransport } from '@/lib/chat/transport'
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
    expect(runner).toHaveBeenCalledWith({ kpiId: 'otp-weekly' }, expect.any(AbortSignal), browserTransport, {
      sidecar: browserSidecarTransport,
    })
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
    const failed = { kind: 'kpi_list', ok: false, error: noContributorMessage('list_kpis') }
    await waitFor(() => expect(postToolResult).toHaveBeenCalledWith('turn', 'k2', failed))
    expect(onResult).toHaveBeenCalledWith('k2', failed)
  })

  it('runs a tool only a pack names, with the transports, and posts the kind that pack declared', async () => {
    const edited = { kind: 'kpi_edit_check', ok: true, kpiId: 'otp-weekly' }
    runner.mockResolvedValue(edited)
    const request = { callId: 'u1', tool: 'update_kpi', args: { kpiId: 'otp-weekly' } } as unknown as AnyToolRequest
    const onResult = vi.fn()
    const { result } = renderHook(() => useToolExecutor())
    result.current.execute('turn', request, onResult)
    await waitFor(() => expect(postToolResult).toHaveBeenCalledWith('turn', 'u1', edited))
    expect(runner).toHaveBeenCalledWith({ kpiId: 'otp-weekly' }, expect.any(AbortSignal), browserTransport, {
      sidecar: browserSidecarTransport,
    })
    expect(onResult).toHaveBeenCalledWith('u1', edited)
  })

  it('posts a failure of the declared kind when the pack runner answers another kind', async () => {
    runner.mockResolvedValue(KPI)
    const request = { callId: 'u2', tool: 'update_kpi', args: {} } as unknown as AnyToolRequest
    const { result } = renderHook(() => useToolExecutor())
    result.current.execute('turn', request, vi.fn())
    await waitFor(() =>
      expect(postToolResult).toHaveBeenCalledWith('turn', 'u2', expect.objectContaining({ kind: 'kpi_edit_check', ok: false }))
    )
  })

  it('answers a pack tool no feature in this build contributes', async () => {
    const request = {
      callId: 'u3',
      tool: 'approve_report',
      args: {},
      resultKind: 'report_check',
    } as unknown as AnyToolRequest
    const onResult = vi.fn()
    const { result } = renderHook(() => useToolExecutor())
    result.current.execute('turn', request, onResult)
    const failed = { kind: 'report_check', ok: false, error: 'This build cannot run approve_report.' }
    await waitFor(() => expect(postToolResult).toHaveBeenCalledWith('turn', 'u3', failed))
    expect(onResult).toHaveBeenCalledWith('u3', failed)
  })
})
