import { describe, expect, it, vi } from 'vitest'
import type { FeatureDescriptor } from '@/features/types'

vi.mock('@/features/generated-registry', () => {
  const FEATURES: Record<string, FeatureDescriptor> = {
    kpis: {
      id: 'kpis',
      nav: [],
      routes: [],
      chatTools: [
        {
          tool: 'update_kpi',
          resultKind: 'kpi_edit_check',
          execute: async () => ({ default: async () => ({ kind: 'kpi_edit_check', ok: true }) }),
          card: async () => ({ default: () => null }),
        },
      ],
    },
  }
  return { FEATURES }
})

import type { ChatFrame } from './frames'
import { applyFrame, emptyThread, fromDetail, settleCall, startTurn } from './thread-model'
import type { ChatThreadDetail } from './wire'

const TURN = 'turn-1'

function requestFrame(tool: string): ChatFrame {
  return { event: 'tool_request', id: '1-1', data: { callId: 'c1', tool, args: {} } as never }
}

function detail(tool: string, content: string): ChatThreadDetail {
  return {
    thread: { id: TURN, title: 't', pinned: false, createdAt: 'x', updatedAt: 'x', lastTurnAt: 'x', origin: 'chat' },
    turns: [
      {
        id: TURN,
        seq: 1,
        status: 'done',
        userText: 'go',
        stopReason: 'end_turn',
        errorId: null,
        createdAt: 'x',
        finishedAt: 'x',
        lastEventId: null,
        blocks: [
          { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: tool, input: { kpiId: 'otp' } }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content }] },
        ],
      },
    ],
    drafts: [],
  } as unknown as ChatThreadDetail
}

describe('calls to tools only a pack names', () => {
  it('keeps the result a contributed tool returned so its card has something to draw', () => {
    let state = startTurn(emptyThread(), TURN, 1, 'go')
    state = applyFrame(state, TURN, requestFrame('update_kpi'))
    state = settleCall(state, 'c1', { kind: 'kpi_edit_check', ok: true, kpiId: 'otp' } as never)
    expect(state.calls.c1).toMatchObject({
      tool: 'update_kpi',
      status: 'done',
      output: { kind: 'kpi_edit_check', ok: true, kpiId: 'otp' },
    })
  })

  it('marks the call failed with the error of an open failure', () => {
    let state = startTurn(emptyThread(), TURN, 1, 'go')
    state = applyFrame(state, TURN, requestFrame('update_kpi'))
    state = settleCall(state, 'c1', { kind: 'kpi_edit_check', ok: false, error: 'nope' } as never)
    expect(state.calls.c1).toMatchObject({ status: 'failed', error: 'nope' })
  })

  it('marks a locally successful call failed when the server settles it as a failure', () => {
    let state = startTurn(emptyThread(), TURN, 1, 'go')
    state = applyFrame(state, TURN, requestFrame('update_kpi'))
    state = settleCall(state, 'c1', { kind: 'kpi_edit_check', ok: true, kpiId: 'otp' } as never)
    state = applyFrame(state, TURN, {
      event: 'tool_settled',
      id: '1-2',
      data: { callId: 'c1', ok: false, durationMs: 5 },
    } as never)
    expect(state.calls.c1.status).toBe('failed')
  })

  it('restores the call and its open result when the thread is reloaded', () => {
    const state = fromDetail(detail('update_kpi', '{"kind":"kpi_edit_check","ok":true,"kpiId":"otp"}'))
    expect(state.calls.c1).toMatchObject({
      tool: 'update_kpi',
      status: 'done',
      output: { kind: 'kpi_edit_check', ok: true, kpiId: 'otp' },
    })
    expect(state.turns[0].items).toContainEqual({ kind: 'call', callId: 'c1' })
  })

  it('restores a failed contributed call with its error text', () => {
    const state = fromDetail(detail('update_kpi', '{"kind":"kpi_edit_check","ok":false,"error":"nope"}'))
    expect(state.calls.c1).toMatchObject({ status: 'failed', error: 'nope' })
  })

  it('draws no card for a tool no feature contributes', () => {
    const state = fromDetail(detail('approve_report', '{"kind":"report_check","ok":true}'))
    expect(state.calls).toEqual({})
  })
})
