import { describe, expect, it } from 'vitest'
import type { ChatFrame } from './frames'
import { applyFrame, emptyThread, fromDetail, startTurn } from './thread-model'
import type { ChatThreadDetail } from './wire'

const TURN = '11111111-1111-4111-8111-111111111111'
const DRAFT = '22222222-2222-4222-8222-222222222222'

const SNAPSHOT = {
  id: 5,
  name: 'Trips',
  description: null,
  sql: 'select 1',
  dataSourceId: 2,
  parameters: [],
  tags: [],
  schedule: null,
  isDraft: false,
  updatedAt: '2026-10-24T10:00:00.123Z',
}
const EDIT = { queryId: 5, snapshot: SNAPSHOT, changes: { sql: 'select 2' } }
const QUERY = {
  name: 'Trips',
  description: '',
  sql: 'select 1',
  dataSourceId: 2,
  vizChoiceId: 'table',
  vizOptions: {},
}

function detail(tool: string, content: string, drafts: ChatThreadDetail['drafts']): ChatThreadDetail {
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
          { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: tool, input: {} }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content }] },
        ],
      },
    ],
    drafts,
  } as ChatThreadDetail
}

describe('stored drafts restore by kind', () => {
  it('stored thread restores a query_edit draft card', () => {
    const state = fromDetail(
      detail('update_query', `{"draftId":"${DRAFT}","version":1,"changed":["sql"]}`, [
        {
          id: DRAFT,
          kind: 'query_edit',
          versions: [{ version: 1, turnId: TURN, payload: EDIT, createdAt: 'x' }],
          promotions: [],
        },
      ])
    )
    expect(state.turns[0].items).toContainEqual({ kind: 'draft', draftId: DRAFT, version: 1 })
    expect(state.editDrafts[DRAFT].versions).toEqual([{ version: 1, payload: EDIT }])
    expect(state.drafts[DRAFT]).toBeUndefined()
  })

  it('stored thread restores a pre-migration query draft', () => {
    const state = fromDetail(
      detail('propose_query', `{"draftId":"${DRAFT}","version":1}`, [
        {
          id: DRAFT,
          kind: 'query',
          versions: [{ version: 1, turnId: TURN, payload: QUERY, createdAt: 'x' }],
          promotions: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              targetType: 'query',
              targetId: '44',
              promotedVersion: 1,
              targetVersionAtPromote: 2,
              status: 'done',
              receipts: [],
              createdAt: 'x',
              updatedAt: 'x',
            },
          ],
        },
      ])
    )
    expect(state.drafts[DRAFT].versions).toEqual([{ version: 1, payload: QUERY }])
    expect(state.drafts[DRAFT].promotions[0].targetId).toBe('44')
    expect(state.turns[0].items).toContainEqual({ kind: 'draft', draftId: DRAFT, version: 1 })
  })

  it('stored thread keeps the parameters of a query proposal', () => {
    const parameters = [{ name: 'day', type: 'enum', enumOptions: 'a\nb', multi: true, quote: 'single' }]
    const state = fromDetail(
      detail('propose_query', `{"draftId":"${DRAFT}","version":1}`, [
        {
          id: DRAFT,
          kind: 'query',
          versions: [{ version: 1, turnId: TURN, payload: { ...QUERY, parameters }, createdAt: 'x' }],
          promotions: [],
        },
      ])
    )
    expect(state.drafts[DRAFT].versions[0].payload.parameters).toEqual(parameters)
  })

  it('restores a draft item from any tool result carrying a draft id and version', () => {
    const state = fromDetail(detail('some_future_tool', `{"draftId":"${DRAFT}","version":1}`, []))
    expect(state.turns[0].items).toContainEqual({ kind: 'draft', draftId: DRAFT, version: 1 })
  })

  it('skips a draft of an unknown kind', () => {
    const state = fromDetail(
      detail('x', '{}', [
        { id: DRAFT, kind: 'mystery', versions: [], promotions: [] },
      ] as ChatThreadDetail['drafts'])
    )
    expect(state.drafts).toEqual({})
    expect(state.editDrafts).toEqual({})
  })

  it('applies a live query_edit draft frame into editDrafts', () => {
    const frame: ChatFrame = {
      event: 'draft',
      id: '1-5',
      data: { draftId: DRAFT, version: 1, kind: 'query_edit', payload: EDIT },
    }
    const state = applyFrame(startTurn(emptyThread(), TURN, 1, 'go'), TURN, frame)
    expect(state.editDrafts[DRAFT].versions).toEqual([{ version: 1, payload: EDIT }])
    expect(state.turns[0].items).toEqual([{ kind: 'draft', draftId: DRAFT, version: 1 }])
  })

  describe('a finished dashboard promotion restored from detail', () => {
    const DASHBOARD = {
      name: 'Overview',
      description: '',
      items: [{ kind: 'existing', queryId: 12, visualizationId: 31 }],
    }

    function restored(promotion: Record<string, unknown>) {
      return fromDetail(
        detail('propose_dashboard', `{"draftId":"${DRAFT}","version":1}`, [
          {
            id: DRAFT,
            kind: 'dashboard',
            versions: [{ version: 1, turnId: TURN, payload: DASHBOARD, createdAt: 'x' }],
            promotions: [
              {
                id: '33333333-3333-4333-8333-333333333333',
                targetType: 'dashboard',
                targetId: '9',
                promotedVersion: 1,
                targetVersionAtPromote: null,
                status: 'done',
                receipts: [],
                createdAt: 'x',
                updatedAt: 'x',
                ...promotion,
              },
            ],
          },
        ] as ChatThreadDetail['drafts'])
      )
    }

    it('uses the recorded widget count, so the append check sees no drift', () => {
      expect(restored({ targetVersionAtPromote: 3 }).activeDashboard).toEqual({ id: 9, name: 'Overview', widgetCount: 3 })
    })

    it('counts widget receipts for a row that lacks the field', () => {
      const receipts = [
        { step: 0, outcome: 'done', targetId: '9' },
        { step: 1, outcome: 'done', targetId: '301' },
        { step: 2, outcome: 'failed', error: 'x' },
      ]
      expect(restored({ receipts }).activeDashboard?.widgetCount).toBe(1)
    })
  })
})
