import { describe, expect, it } from 'vitest'
import type { ChatFrame } from './frames'
import {
  FAILED_TURN_MESSAGE,
  addPromotion,
  applyFrame,
  emptyThread,
  failTurn,
  fromDetail,
  isAfter,
  runningTurn,
  setRunError,
  startTurn,
} from './thread-model'
import type { ChatThreadDetail } from './wire'

const TURN = '11111111-1111-4111-8111-111111111111'
const DRAFT = '22222222-2222-4222-8222-222222222222'
const PROPOSAL = {
  name: 'Average speed',
  description: '',
  sql: 'SELECT 1 FROM t',
  datasetTable: 't',
  vizChoiceId: 'counter',
  vizOptions: {},
}
const PROMOTION = {
  id: '33333333-3333-4333-8333-333333333333',
  targetType: 'query',
  targetId: '44',
  promotedVersion: 1,
  targetVersionAtPromote: 2,
  createdAt: '2026-09-17T00:00:00Z',
}

function running() {
  return startTurn(emptyThread(), TURN, 1, 'how fast?')
}

function frames(state = running(), ...list: ChatFrame[]) {
  return list.reduce((current, frame) => applyFrame(current, TURN, frame), state)
}

const request: ChatFrame = {
  event: 'tool_request',
  id: '1-2',
  data: {
    callId: 'c1',
    tool: 'run_query',
    args: { dataSourceId: 5, sql: 'SELECT 1 FROM t', purpose: 'average', vizChoiceId: 'counter' },
  },
}

describe('applyFrame', () => {
  it('joins text deltas and follows the phase', () => {
    const state = frames(
      undefined,
      { event: 'turn_started', id: '1-0', data: { turnId: TURN, seq: 1 } },
      { event: 'status', id: '1-1', data: { phase: 'answering' } },
      { event: 'text_delta', id: '1-2', data: { text: 'Hel' } },
      { event: 'text_delta', id: '1-3', data: { text: 'lo' } }
    )
    const [turn] = state.turns
    expect(turn.items).toEqual([{ kind: 'text', text: 'Hello' }])
    expect(turn.phase).toBe('answering')
    expect(turn.lastEventId).toBe('1-3')
  })

  it('ignores a frame it has already seen', () => {
    const delta: ChatFrame = { event: 'text_delta', id: '1-2', data: { text: 'once' } }
    expect(frames(undefined, delta, delta).turns[0].items).toEqual([{ kind: 'text', text: 'once' }])
  })

  it('tracks a run from request to settlement', () => {
    const state = frames(undefined, request, {
      event: 'tool_settled',
      id: '1-3',
      data: { callId: 'c1', ok: true, rowCount: 12, durationMs: 4100 },
    })
    expect(state.turns[0].items).toEqual([{ kind: 'run', callId: 'c1' }])
    expect(state.runs.c1).toMatchObject({ status: 'done', rowCount: 12, durationMs: 4100, sql: 'SELECT 1 FROM t' })
  })

  it('records a draft version once', () => {
    const draft: ChatFrame = {
      event: 'draft',
      id: '1-4',
      data: { draftId: DRAFT, version: 1, kind: 'query', payload: PROPOSAL },
    }
    const state = frames(undefined, draft, { ...draft, id: '1-5' })
    expect(state.drafts[DRAFT].versions).toEqual([{ version: 1, payload: PROPOSAL }])
    expect(state.turns[0].items.filter((item) => item.kind === 'draft')).toHaveLength(2)
  })

  it('ends a turn on done or error', () => {
    const done = frames(undefined, { event: 'turn_done', id: '1-9', data: { stopReason: 'end_turn', usage: {} } })
    expect(done.turns[0]).toMatchObject({ status: 'done', stopReason: 'end_turn' })
    expect(runningTurn(done)).toBeNull()
    const failed = frames(undefined, { event: 'error', id: null, data: { id: 'X', message: 'lost' } })
    expect(failed.turns[0]).toMatchObject({ status: 'failed', errorMessage: 'lost' })
  })

  it('ignores frames for a turn it does not know', () => {
    const state = running()
    expect(applyFrame(state, 'other', request)).toBe(state)
  })
})

describe('helpers', () => {
  it('orders stream ids', () => {
    expect(isAfter('2-0', '1-9')).toBe(true)
    expect(isAfter('1-10', '1-9')).toBe(true)
    expect(isAfter('1-9', '1-9')).toBe(false)
    expect(isAfter('1-0', null)).toBe(true)
  })

  it('fails only a running turn, and sets run errors and promotions', () => {
    const state = frames(undefined, request)
    expect(failTurn(state, TURN, 'gone').turns[0].status).toBe('failed')
    expect(setRunError(state, 'c1', 'Unknown table').runs.c1.error).toBe('Unknown table')
    expect(setRunError(state, 'nope', 'x')).toBe(state)
    const drafted = frames(state, { event: 'draft', id: '1-8', data: { draftId: DRAFT, version: 1, kind: 'query', payload: PROPOSAL } })
    expect(addPromotion(drafted, DRAFT, PROMOTION).drafts[DRAFT].promotions).toEqual([PROMOTION])
    expect(addPromotion(state, DRAFT, PROMOTION)).toBe(state)
  })

  it('does not start the same turn twice', () => {
    const state = running()
    expect(startTurn(state, TURN, 1, 'again')).toBe(state)
  })
})

describe('fromDetail', () => {
  const detail: ChatThreadDetail = {
    thread: {
      id: TURN,
      title: 't',
      pinned: false,
      createdAt: 'x',
      updatedAt: 'x',
      lastTurnAt: 'x',
    },
    turns: [
      {
        id: TURN,
        seq: 1,
        status: 'done',
        userText: 'how fast?',
        stopReason: 'end_turn',
        errorId: null,
        createdAt: 'x',
        finishedAt: 'x',
        blocks: [
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Checking.' },
              { type: 'tool_use', id: 'c1', name: 'run_query', input: { sql: 'SELECT 1 FROM t', purpose: 'p', vizChoiceId: 'counter' } },
              { type: 'tool_use', id: 'c2', name: 'run_query', input: { sql: 'DROP' } },
            ],
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'c1', content: '{"ok":true,"rowCount":3}' },
              { type: 'tool_result', tool_use_id: 'c2', content: 'refused', is_error: true },
            ],
          },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'c3', name: 'propose_query', input: {} }],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'c3', content: `{"draftId":"${DRAFT}","version":1}` }],
          },
          { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
        ],
      },
      {
        id: 'failed-turn',
        seq: 2,
        status: 'failed',
        userText: 'again',
        stopReason: null,
        errorId: 'E',
        createdAt: 'x',
        finishedAt: 'x',
        blocks: [],
      },
    ],
    drafts: [
      {
        id: DRAFT,
        kind: 'query',
        versions: [
          { version: 1, turnId: TURN, payload: PROPOSAL, createdAt: 'x' },
          { version: 2, turnId: TURN, payload: { broken: true }, createdAt: 'x' },
        ],
        promotions: [PROMOTION],
      },
    ],
  }

  it('rebuilds the transcript from stored blocks', () => {
    const state = fromDetail(detail)
    expect(state.turns[0].items).toEqual([
      { kind: 'text', text: 'Checking.' },
      { kind: 'run', callId: 'c1' },
      { kind: 'draft', draftId: DRAFT, version: 1 },
      { kind: 'text', text: 'Done.' },
    ])
    expect(state.runs.c1).toMatchObject({ status: 'done', rowCount: 3, purpose: 'p', vizChoiceId: 'counter' })
    expect(state.runs.c2).toBeUndefined()
    expect(state.turns[1]).toMatchObject({ status: 'failed', errorMessage: FAILED_TURN_MESSAGE })
    expect(state.drafts[DRAFT].versions.map((one) => one.version)).toEqual([1])
    expect(state.drafts[DRAFT].promotions).toEqual([PROMOTION])
  })
})
