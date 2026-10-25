import { describe, expect, it } from 'vitest'
import type { DashboardEditPayload } from './dashboard-changes'
import { parseFrame, type ChatFrame } from './frames'
import { addDashboardEditPromotion } from './thread-drafts'
import { applyFrame, emptyThread, fromDetail, startTurn } from './thread-model'
import { toolResultSchema } from './tool-results'
import type { ChatThreadDetail } from './wire'

const TURN = '11111111-1111-4111-8111-111111111111'
const DRAFT = '22222222-2222-4222-8222-222222222222'

const PAYLOAD: DashboardEditPayload = {
  dashboardId: 4,
  snapshot: {
    name: 'Ops',
    tags: ['ops'],
    version: null,
    updatedAt: null,
    widgets: [{ widgetId: 1, kind: 'text', title: 'Notes', position: { col: 0, row: 0, sizeX: 6, sizeY: 4 }, updatedAt: null }],
  },
  name: 'Operations',
  operations: [
    { op: 'editText', widgetId: 1, title: 'Notes', updatedAt: 'U1', text: 'new', position: { col: 0, row: 0, sizeX: 6, sizeY: 4 } },
    { op: 'addText', text: 'Footer', position: { col: 0, row: 4, sizeX: 6, sizeY: 4 } },
  ],
}

function promotion(overrides: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    targetType: 'dashboard',
    targetId: '4',
    promotedVersion: 1,
    targetVersionAtPromote: 5,
    status: 'done',
    receipts: [],
    createdAt: '2026-10-24T10:00:00Z',
    updatedAt: 'x',
    ...overrides,
  }
}

function detail(promotions: unknown[]): ChatThreadDetail {
  return {
    thread: { id: 't' },
    turns: [],
    drafts: [
      {
        id: DRAFT,
        kind: 'dashboard_edit',
        versions: [{ version: 1, turnId: TURN, payload: PAYLOAD, createdAt: 'x' }],
        promotions,
      },
    ],
  } as unknown as ChatThreadDetail
}

describe('frames', () => {
  it('accepts update_dashboard with the operation shapes the sidecar emits', () => {
    const request = {
      callId: 'u1',
      tool: 'update_dashboard',
      args: {
        dashboardId: 4,
        name: 'Ops',
        tags: ['a'],
        operations: [
          { op: 'add', queryId: 7, visualizationId: 70, position: { col: 0, row: 0, sizeX: 3, sizeY: 6 } },
          { op: 'add', queryDraftId: 'qd', parameterMappings: { x: { type: 'static-value', value: null } } },
          { op: 'addText', text: 'hi' },
          { op: 'editText', widgetId: 2, text: 'x' },
          { op: 'remove', widgetId: 3 },
          { op: 'move', widgetId: 4, position: { col: 0, row: 1, sizeX: 2, sizeY: 2 } },
        ],
      },
    }
    expect(parseFrame('tool_request', request, '1-1')?.data).toEqual(request)
  })

  it('refuses an operation with a key it does not take and a position off the grid', () => {
    const base = { callId: 'u1', tool: 'update_dashboard' }
    expect(parseFrame('tool_request', { ...base, args: { dashboardId: 4, operations: [{ op: 'remove', widgetId: 3, text: 'x' }] } }, null)).toBeNull()
    const off = { op: 'move', widgetId: 4, position: { col: 5, row: 0, sizeX: 2, sizeY: 2 } }
    expect(parseFrame('tool_request', { ...base, args: { dashboardId: 4, operations: [off] } }, null)).toBeNull()
  })

  it('accepts a dashboard_edit draft and a text item on a dashboard proposal', () => {
    const edit = { draftId: DRAFT, version: 1, kind: 'dashboard_edit', payload: PAYLOAD }
    expect(parseFrame('draft', edit, '1-2')?.data).toEqual(edit)
    const proposal = {
      draftId: DRAFT,
      version: 1,
      kind: 'dashboard',
      payload: { name: 'D', description: '', items: [{ kind: 'text', text: 'Notes' }] },
    }
    expect(parseFrame('draft', proposal, '1-3')?.data).toEqual(proposal)
    const empty = { ...proposal, payload: { ...proposal.payload, items: [{ kind: 'text', text: '' }] } }
    expect(parseFrame('draft', empty, '1-4')).toBeNull()
  })
})

describe('tool results', () => {
  it('reads a dashboard_edit result, with nulls where the sidecar sends them', () => {
    const result = { kind: 'dashboard_edit', ok: true, dashboardId: 4, snapshot: PAYLOAD.snapshot, operations: PAYLOAD.operations, problems: [] }
    expect(toolResultSchema.safeParse(result).success).toBe(true)
  })

  it('reads an open_dashboard result with text widgets', () => {
    const result = {
      kind: 'dashboard',
      ok: true,
      dashboard: { id: 4, name: 'Ops', version: 2 },
      widgets: [{ widgetId: 1, kind: 'text', title: 'Notes', text: 'Notes', position: { col: 0, row: 0, sizeX: 6, sizeY: 4 } }],
      widgetCount: 0,
      textWidgets: 1,
    }
    expect(toolResultSchema.safeParse(result).success).toBe(true)
  })
})

describe('dashboard_edit drafts in the thread', () => {
  it('applies a live draft frame into dashboardEditDrafts', () => {
    const frame: ChatFrame = { event: 'draft', id: '1-5', data: { draftId: DRAFT, version: 1, kind: 'dashboard_edit', payload: PAYLOAD } }
    const state = applyFrame(startTurn(emptyThread(), TURN, 1, 'go'), TURN, frame)
    expect(state.dashboardEditDrafts[DRAFT].versions).toEqual([{ version: 1, payload: PAYLOAD }])
    expect(state.turns[0].items).toEqual([{ kind: 'draft', draftId: DRAFT, version: 1 }])
  })

  it('restores the draft from a stored thread and drops a payload that no longer parses', () => {
    const state = fromDetail(detail([]))
    expect(state.dashboardEditDrafts[DRAFT].versions[0].payload).toEqual(PAYLOAD)
    const bad = detail([])
    bad.drafts[0].versions[0].payload = { dashboardId: 'x' }
    expect(fromDetail(bad).dashboardEditDrafts[DRAFT].versions).toEqual([])
  })

  it('makes a finished edit the active dashboard, with the recorded chart count', () => {
    expect(fromDetail(detail([promotion()])).activeDashboard).toEqual({ id: 4, name: 'Operations', widgetCount: 5 })
  })

  it('ignores a partial edit and one that recorded no count', () => {
    expect(fromDetail(detail([promotion({ status: 'partial' })])).activeDashboard).toBeNull()
    expect(fromDetail(detail([promotion({ targetVersionAtPromote: null })])).activeDashboard).toBeNull()
  })

  it('records a promotion on the edit draft', () => {
    const state = fromDetail(detail([]))
    const next = addDashboardEditPromotion(state, DRAFT, promotion() as never)
    expect(next.dashboardEditDrafts[DRAFT].promotions).toHaveLength(1)
    expect(addDashboardEditPromotion(state, 'other', promotion() as never)).toBe(state)
  })
})
