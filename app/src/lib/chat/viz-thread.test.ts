import { describe, expect, it } from 'vitest'
import { draftKind } from './draft-kinds'
import { parseFrame, type ChatFrame } from './frames'
import { addVizPromotion, applyFrame, emptyThread, fromDetail, startTurn } from './thread-model'
import { toolResultSchema } from './tool-results'
import type { ChatThreadDetail } from './wire'

const TURN = '11111111-1111-4111-8111-111111111111'
const DRAFT = '22222222-2222-4222-8222-222222222222'

const EDIT_PAYLOAD = {
  mode: 'edit',
  queryId: 5,
  visualizationId: 11,
  snapshot: { type: 'CHART', name: 'Bars', options: { a: 1 }, updatedAt: 'u' },
  next: { type: 'CHART', name: 'Bars', options: { a: 2 } },
}

describe('visualization tool requests', () => {
  it('accepts each tool with its own arguments', () => {
    const requests = [
      { callId: 'a', tool: 'describe_visualization_type', args: { type: 'CHART' } },
      { callId: 'b', tool: 'propose_visualization', args: { queryId: 5, type: 'CHART', name: 'Bars', options: {} } },
      {
        callId: 'c',
        tool: 'update_visualization',
        args: {
          queryId: 5,
          visualizationId: 11,
          type: 'PIVOT',
          name: 'x',
          set: [{ path: 'a.b', value: 1 }],
          unset: ['c'],
        },
      },
      { callId: 'd', tool: 'delete_visualization', args: { queryId: 5, visualizationId: 11 } },
    ]
    for (const request of requests) {
      expect(parseFrame('tool_request', request, '1-1')?.data).toEqual(request)
    }
  })

  it('refuses update_visualization without its query id and a delete with extra keys', () => {
    expect(
      parseFrame('tool_request', { callId: 'a', tool: 'update_visualization', args: { visualizationId: 11 } }, null)
    ).toBeNull()
    expect(
      parseFrame(
        'tool_request',
        { callId: 'a', tool: 'delete_visualization', args: { queryId: 5, visualizationId: 11, force: true } },
        null
      )
    ).toBeNull()
  })
})

describe('visualization results and drafts', () => {
  it('parses the two result kinds', () => {
    expect(
      toolResultSchema.safeParse({ kind: 'visualization_type', ok: true, type: 'CHART', label: 'Chart', options: [{ key: 'a' }] })
        .success
    ).toBe(true)
    expect(
      toolResultSchema.safeParse({ kind: 'visualization_check', ok: true, mode: 'delete', queryId: 5, problems: [] }).success
    ).toBe(true)
  })

  it('files the visualization kind in its own slot', () => {
    expect(draftKind('visualization').slot).toBe('vizDrafts')
    expect(draftKind('visualization').parse(EDIT_PAYLOAD)).not.toBeNull()
    expect(draftKind('visualization').parse({ mode: 'delete', queryId: 5 })).toBeNull()
  })

  it('a draft frame lands in vizDrafts and a promotion is added to it', () => {
    const frame = parseFrame(
      'draft',
      { draftId: DRAFT, version: 1, kind: 'visualization', payload: EDIT_PAYLOAD },
      '1-2'
    ) as ChatFrame
    const started = startTurn(emptyThread(), TURN, 1, 'go')
    const state = applyFrame(started, TURN, frame)
    expect(state.vizDrafts[DRAFT].versions).toEqual([{ version: 1, payload: EDIT_PAYLOAD }])
    expect(state.turns[0].items).toContainEqual({ kind: 'draft', draftId: DRAFT, version: 1 })
    const promotion = { id: 'p1', status: 'done', receipts: [], targetId: '5', promotedVersion: 1 } as never
    expect(addVizPromotion(state, DRAFT, promotion).vizDrafts[DRAFT].promotions).toHaveLength(1)
  })

  it('a stored thread restores a visualization draft card', () => {
    const detail = {
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
            { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'update_visualization', input: {} }] },
            {
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: 'c1', content: `{"draftId":"${DRAFT}","version":1}` }],
            },
          ],
        },
      ],
      drafts: [
        {
          id: DRAFT,
          kind: 'visualization',
          versions: [{ version: 1, turnId: TURN, payload: EDIT_PAYLOAD, createdAt: 'x' }],
          promotions: [],
        },
      ],
    } as unknown as ChatThreadDetail
    const state = fromDetail(detail)
    expect(state.vizDrafts[DRAFT].versions).toEqual([{ version: 1, payload: EDIT_PAYLOAD }])
    expect(state.turns[0].items).toContainEqual({ kind: 'draft', draftId: DRAFT, version: 1 })
  })
})
