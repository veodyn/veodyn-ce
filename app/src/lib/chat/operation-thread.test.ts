import { describe, expect, it } from 'vitest'
import { draftKind } from './draft-kinds'
import { isOpenToolRequest, parseFrame, type AnyToolRequest, type ChatFrame } from './frames'
import { addOperationPromotion } from './thread-drafts'
import { applyFrame, emptyThread, fromDetail, startTurn } from './thread-model'
import { toolResultSchema } from './tool-results'
import type { ChatThreadDetail } from './wire'

const TURN = '11111111-1111-4111-8111-111111111111'
const DRAFT = '22222222-2222-4222-8222-222222222222'

const ARCHIVE_PAYLOAD = {
  op: 'archive',
  target: { kind: 'query', id: 7, name: 'Weekly revenue' },
  params: { summary: 'Archive "Weekly revenue".', consequence: 'Its alerts go.' },
  destructive: true,
  snapshot: { updatedAt: '2026-10-24T10:00:00Z' },
}

const SIDECAR_REQUESTS = [
  { callId: 'a', tool: 'fork_query', args: { queryId: 7 } },
  { callId: 'b', tool: 'archive_query', args: { queryId: 7, restore: false } },
  { callId: 'c', tool: 'archive_dashboard', args: { dashboardId: 3, restore: true } },
  { callId: 'd', tool: 'set_favorite', args: { kind: 'dashboard', id: 3, favorite: true } },
  { callId: 'e', tool: 'share_dashboard', args: { dashboardId: 3, action: 'create', expiresAt: null } },
  {
    callId: 'f',
    tool: 'share_visualization',
    args: { queryId: 7, visualizationId: 31, action: 'create', expiresAt: '2026-12-01T00:00:00Z', refreshSeconds: 60 },
  },
  { callId: 'g', tool: 'download_result', args: { queryId: 7, format: 'xlsx' } },
  {
    callId: 'h',
    tool: 'search_library',
    args: { text: '', kinds: ['query'], tags: [], sort: 'match', archived: true },
  },
]

function stored(name: string, content: string, input: Record<string, unknown> = {}): ChatThreadDetail {
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
          { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name, input }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content }] },
        ],
      },
    ],
    drafts:
      name === 'archive_query'
        ? [
            {
              id: DRAFT,
              kind: 'operation',
              versions: [{ version: 1, turnId: TURN, payload: ARCHIVE_PAYLOAD, createdAt: 'x' }],
              promotions: [],
            },
          ]
        : [],
  } as unknown as ChatThreadDetail
}

describe('operation tool requests', () => {
  it('reads every frame the sidecar sends as a known tool, archived search included', () => {
    for (const request of SIDECAR_REQUESTS) {
      const frame = parseFrame('tool_request', { ...request, resultKind: 'operation_check' }, '1-1')
      expect(frame?.data).toEqual(request)
      expect(isOpenToolRequest(frame?.data as AnyToolRequest)).toBe(false)
    }
  })

  it('refuses a refresh cadence the embed dialog does not offer, and a favorite of a report', () => {
    const cadence = { ...SIDECAR_REQUESTS[5], args: { ...SIDECAR_REQUESTS[5].args, refreshSeconds: 45 } }
    const report = { callId: 'd', tool: 'set_favorite', args: { kind: 'report', id: 3, favorite: true } }
    expect(parseFrame('tool_request', cadence, null)).toBeNull()
    expect(parseFrame('tool_request', report, null)).toBeNull()
  })
})

describe('operation results and drafts', () => {
  it('parses the operation check and the download', () => {
    const check = { kind: 'operation_check', ok: true, op: 'fork', target: { kind: 'query', id: 7, name: 'x' }, params: {}, destructive: false, problems: [] }
    const download = { kind: 'download', ok: true, queryId: 7, format: 'csv', href: '/api/node/queries/7/results.csv' }
    expect(toolResultSchema.safeParse(check).success).toBe(true)
    expect(toolResultSchema.safeParse(download).success).toBe(true)
  })

  it('files the operation kind in its own slot', () => {
    expect(draftKind('operation').slot).toBe('operationDrafts')
    expect(draftKind('operation').parse(ARCHIVE_PAYLOAD)).not.toBeNull()
    expect(draftKind('operation').parse({ op: 'archive' })).toBeNull()
  })

  it('a draft frame lands in operationDrafts and takes a promotion', () => {
    const frame = parseFrame('draft', { draftId: DRAFT, version: 1, kind: 'operation', payload: ARCHIVE_PAYLOAD }, '1-2')
    const state = applyFrame(startTurn(emptyThread(), TURN, 1, 'go'), TURN, frame as ChatFrame)
    expect(state.operationDrafts[DRAFT].versions).toEqual([{ version: 1, payload: ARCHIVE_PAYLOAD }])
    expect(state.turns[0].items).toContainEqual({ kind: 'draft', draftId: DRAFT, version: 1 })
    const promotion = { id: 'p1', status: 'done', receipts: [], targetId: '7', promotedVersion: 1 } as never
    expect(addOperationPromotion(state, DRAFT, promotion).operationDrafts[DRAFT].promotions).toHaveLength(1)
  })

  it('a stored thread restores the operation card', () => {
    const state = fromDetail(stored('archive_query', `{"draftId":"${DRAFT}","version":1,"destructive":true}`))
    expect(state.operationDrafts[DRAFT].versions).toEqual([{ version: 1, payload: ARCHIVE_PAYLOAD }])
    expect(state.turns[0].items).toContainEqual({ kind: 'draft', draftId: DRAFT, version: 1 })
  })

  it('a stored thread restores the download card', () => {
    const content = JSON.stringify({ kind: 'download', ok: true, queryId: 7, format: 'csv', href: '/api/node/queries/7/results.csv' })
    const state = fromDetail(stored('download_result', content, { queryId: 7, format: 'csv' }))
    expect(state.calls.c1).toMatchObject({ tool: 'download_result', status: 'done', output: { kind: 'download', href: '/api/node/queries/7/results.csv' } })
    expect(state.turns[0].items).toContainEqual({ kind: 'call', callId: 'c1' })
  })
})
