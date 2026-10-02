import { describe, expect, it } from 'vitest'
import { parseFrame } from './frames'
import { fromDetail } from './thread-stored'
import { toolResultSchema } from './tool-results'
import type { ChatThreadDetail } from './wire'

const POINT = { at: '2026-09-18T06:00:00Z', value: 81, status: 'breached' }

const KPI = {
  ok: true,
  kind: 'kpi',
  kpi: {
    id: 'otp-weekly',
    name: 'On-time performance',
    description: 'Share of trips within five minutes of schedule.',
    domain: 'transit',
    unit: '%',
    cadence: 'weekly',
    owner: 'Dana',
    target: { value: 90, direction: 'higher-is-better' },
    thresholds: { atRisk: 88, breached: 85 },
  },
  evaluation: { value: 81, status: 'breached', delta: -4.5, asOf: '2026-09-18T06:00:00Z', stale: false },
  history: [{ at: '2026-09-11T06:00:00Z', value: 85.5, status: 'at-risk' }, POINT],
  retrievedAt: '2026-09-19T12:00:00Z',
}

const KPI_LIST = {
  ok: true,
  kind: 'kpi_list',
  items: [
    { id: 'otp-weekly', name: 'On-time performance', unit: '%', value: 81, status: 'breached' },
    { id: 'ridership', name: 'Ridership', status: 'no-data' },
  ],
  more: false,
}

describe('the KPI tool requests', () => {
  it('are accepted with their own arguments', () => {
    const requests = [
      { callId: 'a', tool: 'show_kpi', args: { kpiId: 'otp-weekly' } },
      { callId: 'b', tool: 'list_kpis', args: {} },
    ]
    for (const request of requests) {
      expect(parseFrame('tool_request', request, '1-1')?.data).toEqual(request)
    }
  })

  it('refuse an id that is not a slug, and arguments nobody declared', () => {
    const bad = [
      { callId: 'a', tool: 'show_kpi', args: { kpiId: 'transit/otp' } },
      { callId: 'a', tool: 'show_kpi', args: { kpiId: '' } },
      { callId: 'a', tool: 'show_kpi', args: { kpiId: 'otp', queryId: 1 } },
      { callId: 'a', tool: 'list_kpis', args: { domain: 'transit' } },
    ]
    for (const request of bad) expect(parseFrame('tool_request', request, null)).toBeNull()
  })
})

describe('the KPI tool results', () => {
  it('are accepted whole, and as a bare failure', () => {
    expect(toolResultSchema.safeParse(KPI).success).toBe(true)
    expect(toolResultSchema.safeParse(KPI_LIST).success).toBe(true)
    expect(toolResultSchema.safeParse({ ok: false, kind: 'kpi', error: 'No KPI has that id.' }).success).toBe(true)
  })

  it('refuse more history than the card draws, more rows than the list shows, and unknown keys', () => {
    const bad = [
      { ...KPI, history: Array.from({ length: 201 }, () => POINT) },
      { ...KPI_LIST, items: Array.from({ length: 51 }, () => KPI_LIST.items[0]) },
      { ...KPI, sql: 'SELECT 1' },
      { ...KPI, kpi: { ...KPI.kpi, id: 'transit/otp' } },
      { ...KPI, evaluation: { ...KPI.evaluation, status: 'fine' } },
    ]
    for (const result of bad) expect(toolResultSchema.safeParse(result).success).toBe(false)
  })
})

describe('a stored KPI call', () => {
  it('comes back as a settled card with the result it was drawn from', () => {
    const detail = {
      thread: { id: 't', title: '', pinned: false, createdAt: '', updatedAt: '', lastTurnAt: '' },
      turns: [
        {
          id: 'turn',
          seq: 1,
          status: 'done',
          userText: 'Show me this KPI',
          stopReason: 'end_turn',
          errorId: null,
          createdAt: '',
          finishedAt: '',
          blocks: [
            {
              role: 'assistant',
              content: [{ type: 'tool_use', id: 'k1', name: 'show_kpi', input: { kpiId: 'otp-weekly' } }],
            },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'k1', content: JSON.stringify(KPI) }] },
          ],
        },
      ],
      drafts: [],
    } as ChatThreadDetail
    const state = fromDetail(detail)
    expect(state.turns[0].items).toEqual([{ kind: 'call', callId: 'k1' }])
    expect(state.calls.k1).toMatchObject({ tool: 'show_kpi', status: 'done', target: null })
    expect(state.calls.k1.output).toEqual(KPI)
  })
})
