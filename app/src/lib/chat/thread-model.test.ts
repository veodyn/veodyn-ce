import { describe, expect, it } from 'vitest'
import type { ChatFrame } from './frames'
import {
  FAILED_TURN_MESSAGE,
  addDashboardPromotion,
  addPromotion,
  applyFrame,
  emptyThread,
  failTurn,
  fromDetail,
  isAfter,
  runningTurn,
  setActiveDashboard,
  setRunError,
  settleCall,
  startTurn,
} from './thread-model'
import type { ChatThreadDetail } from './wire'

const TURN = '11111111-1111-4111-8111-111111111111'
const DRAFT = '22222222-2222-4222-8222-222222222222'
const PROPOSAL = {
  name: 'Average speed',
  description: '',
  sql: 'SELECT 1 FROM t',
  dataSourceId: 5,
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
const DASHBOARD_DRAFT = '55555555-5555-4555-8555-555555555555'
const DASHBOARD_PROPOSAL = {
  name: 'Bikeshare overview',
  description: '',
  items: [{ kind: 'existing' as const, queryId: 12, visualizationId: 31 }],
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
    expect(state.runs.c1).toMatchObject({
      status: 'done',
      rowCount: 12,
      durationMs: 4100,
      sql: 'SELECT 1 FROM t',
      dataSourceId: 5,
    })
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

  it('rebuilds a resourceCall run with the data source the result echoed back', () => {
    const withResourceCall = {
      ...detail,
      turns: [
        {
          ...detail.turns[0],
          blocks: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: 'r1',
                  name: 'run_query',
                  input: { resourceCall: { resource: 'predictions', params: { stop_id: '80101' } }, purpose: 'p', vizChoiceId: 'table' },
                },
              ],
            },
            {
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: 'r1', content: '{"ok":true,"rowCount":2,"dataSourceId":7}' }],
            },
          ],
        },
        detail.turns[1],
      ],
    }
    const state = fromDetail(withResourceCall)
    expect(state.runs.r1).toMatchObject({
      dataSourceId: 7,
      sql: '{"resource":"predictions","params":{"stop_id":"80101"}}',
    })
  })
})

describe('dashboard drafts', () => {
  const dashboardDraftFrame: ChatFrame = {
    event: 'draft',
    id: '1-4',
    data: { draftId: DASHBOARD_DRAFT, version: 1, kind: 'dashboard', payload: DASHBOARD_PROPOSAL },
  }
  const openDashboard: ChatFrame = {
    event: 'tool_request',
    id: '1-2',
    data: { callId: 'od1', tool: 'open_dashboard', args: { dashboardId: 4 } },
  }
  const dashboardResult = {
    kind: 'dashboard' as const,
    ok: true,
    dashboard: { id: 4, name: 'Bikeshare overview' },
    widgets: [],
    widgetCount: 3,
  }

  it('routes a dashboard-kind draft frame into dashboardDrafts, not drafts', () => {
    const state = frames(undefined, dashboardDraftFrame)
    expect(state.dashboardDrafts[DASHBOARD_DRAFT].versions).toEqual([{ version: 1, payload: DASHBOARD_PROPOSAL }])
    expect(state.drafts[DASHBOARD_DRAFT]).toBeUndefined()
    expect(state.turns[0].items).toEqual([{ kind: 'draft', draftId: DASHBOARD_DRAFT, version: 1 }])
  })

  it('sets activeDashboard when an open_dashboard call settles', () => {
    let state = frames(undefined, openDashboard)
    expect(state.activeDashboard).toBeNull()
    state = settleCall(state, 'od1', dashboardResult)
    expect(state.activeDashboard).toEqual({ id: 4, name: 'Bikeshare overview', widgetCount: 3 })
  })

  it('falls back to the (capped) widgets array length when widgetCount is absent', () => {
    const state = settleCall(
      frames(undefined, openDashboard),
      'od1',
      { ...dashboardResult, widgetCount: undefined, widgets: [{}, {}] as never }
    )
    expect(state.activeDashboard?.widgetCount).toBe(2)
  })

  it('does not set activeDashboard for a failed open_dashboard', () => {
    const state = settleCall(frames(undefined, openDashboard), 'od1', { kind: 'dashboard', ok: false, error: 'gone' })
    expect(state.activeDashboard).toBeNull()
  })

  it('records a dashboard promotion against dashboardDrafts, and setActiveDashboard replaces the pointer', () => {
    const state = frames(undefined, dashboardDraftFrame)
    const promoted = addDashboardPromotion(state, DASHBOARD_DRAFT, PROMOTION)
    expect(promoted.dashboardDrafts[DASHBOARD_DRAFT].promotions).toEqual([PROMOTION])
    expect(addDashboardPromotion(state, 'nope', PROMOTION)).toBe(state)
    const activated = setActiveDashboard(state, { id: 9, name: 'New', widgetCount: 1 })
    expect(activated.activeDashboard).toEqual({ id: 9, name: 'New', widgetCount: 1 })
  })

  it('rebuilds a dashboard draft from a stored propose_dashboard call', () => {
    const detail = {
      thread: { id: TURN, title: '', pinned: false, createdAt: '', updatedAt: '', lastTurnAt: '' },
      turns: [
        {
          id: TURN,
          seq: 1,
          status: 'done',
          userText: 'dashboard please',
          stopReason: 'end_turn',
          errorId: null,
          createdAt: '',
          finishedAt: '',
          blocks: [
            {
              role: 'assistant',
              content: [{ type: 'tool_use', id: 'pd1', name: 'propose_dashboard', input: {} }],
            },
            {
              role: 'user',
              content: [
                { type: 'tool_result', tool_use_id: 'pd1', content: `{"draftId":"${DASHBOARD_DRAFT}","version":1}` },
              ],
            },
          ],
        },
      ],
      drafts: [
        {
          id: DASHBOARD_DRAFT,
          kind: 'dashboard',
          versions: [{ version: 1, turnId: TURN, payload: DASHBOARD_PROPOSAL, createdAt: 'x' }],
          promotions: [],
        },
      ],
    } as ChatThreadDetail
    const state = fromDetail(detail)
    expect(state.turns[0].items).toEqual([{ kind: 'draft', draftId: DASHBOARD_DRAFT, version: 1 }])
    expect(state.dashboardDrafts[DASHBOARD_DRAFT].versions).toEqual([{ version: 1, payload: DASHBOARD_PROPOSAL }])
    expect(state.drafts[DASHBOARD_DRAFT]).toBeUndefined()
  })

  it('reconstructs activeDashboard as the latest of an open_dashboard call and a dashboard promotion', () => {
    const detail = {
      thread: { id: TURN, title: '', pinned: false, createdAt: '', updatedAt: '', lastTurnAt: '' },
      turns: [
        {
          id: TURN,
          seq: 1,
          status: 'done',
          userText: 'open it',
          stopReason: 'end_turn',
          errorId: null,
          createdAt: '2026-09-17T00:00:00Z',
          finishedAt: '2026-09-17T00:01:00Z',
          blocks: [
            { role: 'assistant', content: [{ type: 'tool_use', id: 'od1', name: 'open_dashboard', input: { dashboardId: 4 } }] },
            {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'od1',
                  content: JSON.stringify({ ok: true, dashboard: { id: 4, name: 'Older' }, widgets: [], widgetCount: 1 }),
                },
              ],
            },
          ],
        },
      ],
      drafts: [
        {
          id: DASHBOARD_DRAFT,
          kind: 'dashboard',
          versions: [{ version: 1, turnId: TURN, payload: DASHBOARD_PROPOSAL, createdAt: 'x' }],
          promotions: [{ ...PROMOTION, targetType: 'dashboard', targetId: '9', targetVersionAtPromote: 3, createdAt: '2026-09-17T00:02:00Z' }],
        },
      ],
    } as ChatThreadDetail
    const state = fromDetail(detail)
    expect(state.activeDashboard).toEqual({ id: 9, name: 'Bikeshare overview', widgetCount: 3 })
  })

  it('has no activeDashboard when neither an open_dashboard call nor a dashboard promotion exists', () => {
    const empty = {
      thread: { id: TURN, title: '', pinned: false, createdAt: '', updatedAt: '', lastTurnAt: '' },
      turns: [],
      drafts: [],
    } as ChatThreadDetail
    expect(fromDetail(empty).activeDashboard).toBeNull()
  })
})

describe('library calls', () => {
  const search: ChatFrame = {
    event: 'tool_request',
    id: '1-2',
    data: { callId: 's1', tool: 'search_library', args: { text: 'bikeshare', kinds: ['query'], tags: [] } },
  }
  const show: ChatFrame = {
    event: 'tool_request',
    id: '1-3',
    data: { callId: 'v1', tool: 'show_visualization', args: { queryId: 12, visualizationId: null } },
  }
  const library = {
    kind: 'library' as const,
    ok: true,
    items: [{ type: 'query' as const, id: 12, name: 'Trips' }],
    more: false,
  }

  it('adds a call item for each library request and settles it from the result', () => {
    let state = frames(undefined, search, show)
    expect(state.turns[0].items).toEqual([
      { kind: 'call', callId: 's1' },
      { kind: 'call', callId: 'v1' },
    ])
    expect(state.calls.s1).toMatchObject({ tool: 'search_library', status: 'running', target: null })
    expect(state.calls.v1.target).toEqual({ queryId: 12, visualizationId: null })
    state = settleCall(state, 's1', library)
    expect(state.calls.s1).toMatchObject({ status: 'done', output: library, error: null })
    state = frames(state, { event: 'tool_settled', id: '1-4', data: { callId: 's1', ok: false, durationMs: 3 } })
    expect(state.calls.s1.status).toBe('done')
    state = settleCall(state, 'v1', { kind: 'saved_visualization', ok: false, error: 'gone' })
    expect(state.calls.v1).toMatchObject({ status: 'failed', error: 'gone' })
    expect(settleCall(state, 'nope', library)).toBe(state)
  })

  it('takes the settled frame when no result arrived in this tab', () => {
    const state = frames(undefined, search, {
      event: 'tool_settled',
      id: '1-3',
      data: { callId: 's1', ok: false, durationMs: 120_000 },
    })
    expect(state.calls.s1).toMatchObject({ status: 'failed', output: null })
  })

  it('rebuilds calls from a stored turn', () => {
    const detail = {
      thread: { id: TURN, title: '', pinned: false, createdAt: '', updatedAt: '', lastTurnAt: '' },
      drafts: [],
      turns: [
        {
          id: TURN,
          seq: 1,
          status: 'done',
          userText: 'bikeshare?',
          stopReason: 'end_turn',
          errorId: null,
          createdAt: '',
          finishedAt: '',
          blocks: [
            {
              role: 'assistant',
              content: [
                { type: 'tool_use', id: 's1', name: 'search_library', input: { text: 'bikeshare' } },
                { type: 'tool_use', id: 'v1', name: 'show_visualization', input: { queryId: 12, visualizationId: 31 } },
                { type: 'tool_use', id: 'd1', name: 'open_dashboard', input: { dashboardId: 4 } },
              ],
            },
            {
              role: 'user',
              content: [
                { type: 'tool_result', tool_use_id: 's1', content: JSON.stringify(library) },
                {
                  type: 'tool_result',
                  tool_use_id: 'v1',
                  content: JSON.stringify({ kind: 'saved_visualization', ok: true, rowCount: 1 }),
                },
                {
                  type: 'tool_result',
                  tool_use_id: 'd1',
                  content: JSON.stringify({ ok: false, error: 'The browser did not answer in time.' }),
                  is_error: true,
                },
              ],
            },
          ],
        },
      ],
    } as ChatThreadDetail
    const state = fromDetail(detail)
    expect(state.turns[0].items).toEqual([
      { kind: 'call', callId: 's1' },
      { kind: 'call', callId: 'v1' },
      { kind: 'call', callId: 'd1' },
    ])
    expect(state.calls.s1).toMatchObject({ status: 'done', output: library })
    expect(state.calls.v1).toMatchObject({ status: 'done', target: { queryId: 12, visualizationId: 31 } })
    expect(state.calls.d1).toMatchObject({
      status: 'failed',
      output: null,
      error: 'The browser did not answer in time.',
    })
  })
})

describe('help links', () => {
  const card = {
    callId: 'h1',
    page: 'features/queries',
    pageTitle: 'Queries',
    anchor: 'parameters',
    sectionTitle: 'Parameters',
    reason: 'How to add a date filter',
  }
  const link: ChatFrame = { event: 'help_link', id: '1-2', data: card }

  it('adds a help item and keeps the link beside the turn', () => {
    const state = frames(undefined, link)
    expect(state.turns[0].items).toEqual([{ kind: 'help', callId: 'h1' }])
    expect(state.helpLinks.h1).toEqual(card)
  })

  it('rebuilds a help link from the stored call and skips a refused one', () => {
    const detail = {
      thread: { id: TURN, title: '', pinned: false, createdAt: '', updatedAt: '', lastTurnAt: '' },
      drafts: [],
      turns: [
        {
          id: TURN,
          seq: 1,
          status: 'done',
          userText: 'how do I add a date filter?',
          stopReason: 'end_turn',
          errorId: null,
          createdAt: '',
          finishedAt: '',
          blocks: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: 'h1',
                  name: 'link_help',
                  input: { page: 'features/queries', section: 'parameters', reason: 'How to add a date filter' },
                },
                { type: 'tool_use', id: 'h2', name: 'link_help', input: { page: 'nowhere', reason: 'x' } },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'h1',
                  content: JSON.stringify({
                    linked: true,
                    page: 'features/queries',
                    section: 'parameters',
                    pageTitle: 'Queries',
                    sectionTitle: 'Parameters',
                  }),
                },
                {
                  type: 'tool_result',
                  tool_use_id: 'h2',
                  content: 'there is no documentation page',
                  is_error: true,
                },
              ],
            },
          ],
        },
      ],
    } as ChatThreadDetail
    const state = fromDetail(detail)
    expect(state.turns[0].items).toEqual([{ kind: 'help', callId: 'h1' }])
    expect(state.helpLinks.h1).toEqual(card)
    expect(state.helpLinks.h2).toBeUndefined()
  })
})
