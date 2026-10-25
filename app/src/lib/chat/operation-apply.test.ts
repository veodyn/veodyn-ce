import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/services/api-client'
import { applyOperation, CONFIRM_FIRST, type OperationDraft } from './operation-apply'
import type { OperationPayload } from './operation-changes'
import { STAMP } from './operation-fixtures'
import type { RedashTransport } from './transport'

const chat = vi.hoisted(() => ({ recordPromotion: vi.fn(), patchPromotion: vi.fn() }))
vi.mock('@/services/ai/chat-client', () => chat)

const PENDING = { id: 'p1', status: 'pending', receipts: [], targetId: '7' }
const QUERY = { kind: 'query' as const, id: 7, name: 'Weekly revenue' }
const DASHBOARD = { kind: 'dashboard' as const, id: 3, name: 'Ops' }
const CHART = { kind: 'visualization' as const, id: 31, name: 'Revenue by week', queryId: 7 }
const OPTIONS = { confirmed: false, overwrite: false, queryDrafts: true }

function draftOf(payload: OperationPayload): OperationDraft {
  return { id: 'd1', versions: [{ version: 2, payload }], promotions: [] }
}

function op(partial: Partial<OperationPayload> & Pick<OperationPayload, 'op' | 'target'>): OperationDraft {
  return draftOf({ params: {}, destructive: false, ...partial })
}

function transportOf(answers: { post?: unknown; del?: unknown } = {}) {
  const answer = (value: unknown) => async () => {
    if (value instanceof Error) throw value
    return value
  }
  return { get: vi.fn(), post: vi.fn(answer(answers.post ?? {})), del: vi.fn(answer(answers.del)) } as unknown as RedashTransport & {
    post: ReturnType<typeof vi.fn>
    del: ReturnType<typeof vi.fn>
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  chat.recordPromotion.mockResolvedValue(PENDING)
  chat.patchPromotion.mockImplementation(async (_d: string, _p: string, patch: object) => ({ ...PENDING, ...patch }))
})

describe('applyOperation: the second click', () => {
  it('never applies a destructive operation without the confirmation, and records nothing', async () => {
    const transport = transportOf()
    const draft = op({ op: 'archive', target: QUERY, destructive: true, snapshot: { updatedAt: STAMP } })
    expect(await applyOperation(draft, 2, transport, OPTIONS)).toEqual({ status: 'failed', error: CONFIRM_FIRST })
    expect(transport.del).not.toHaveBeenCalled()
    expect(chat.recordPromotion).not.toHaveBeenCalled()
  })

  it('archives a confirmed query with the precondition and a query promotion', async () => {
    const transport = transportOf()
    const draft = op({ op: 'archive', target: QUERY, destructive: true, snapshot: { updatedAt: STAMP } })
    const outcome = await applyOperation(draft, 2, transport, { ...OPTIONS, confirmed: true })
    expect(chat.recordPromotion).toHaveBeenCalledWith('d1', { version: 2, targetType: 'query', targetId: '7', status: 'pending' })
    expect(transport.del.mock.calls[0].slice(0, 2)).toEqual(['queries/7', { expected_updated_at: STAMP }])
    expect(outcome).toMatchObject({ status: 'done' })
    expect(chat.patchPromotion).toHaveBeenCalledWith('d1', 'p1', {
      status: 'done',
      targetId: '7',
      receipts: [{ step: 0, outcome: 'done', targetId: '7' }],
    })
  })

  it('turns a stale archive into a conflict, and overwriting drops the precondition', async () => {
    const stale = transportOf({ del: new ApiError(409, 'changed') })
    const draft = op({ op: 'archive', target: DASHBOARD, destructive: true, snapshot: { updatedAt: STAMP } })
    expect(await applyOperation(draft, 2, stale, { ...OPTIONS, confirmed: true })).toEqual({ status: 'conflict' })
    const transport = transportOf()
    await applyOperation(draft, 2, transport, { ...OPTIONS, confirmed: true, overwrite: true })
    expect(transport.del.mock.calls[0].slice(0, 2)).toEqual(['dashboards/3', undefined])
    expect(chat.recordPromotion).toHaveBeenLastCalledWith('d1', expect.objectContaining({ targetType: 'dashboard' }))
  })
})

describe('applyOperation: fork', () => {
  it('forks with the idempotency key and records the copy as the target', async () => {
    const transport = transportOf({ post: { id: 41, updated_at: STAMP } })
    const outcome = await applyOperation(op({ op: 'fork', target: QUERY }), 2, transport, OPTIONS)
    expect(transport.post.mock.calls[0].slice(0, 2)).toEqual(['queries/7/fork', { idempotency_key: 'd1:2:0' }])
    expect(transport.post).toHaveBeenCalledTimes(1)
    expect(outcome).toMatchObject({ status: 'done', result: { forkId: 41 } })
    expect(chat.patchPromotion).toHaveBeenCalledWith('d1', 'p1', {
      status: 'done',
      targetId: '41',
      receipts: [{ step: 0, outcome: 'done', targetId: '41', updatedAt: STAMP }],
    })
  })

  it('sends the same key on a second Apply, so node replays the one copy', async () => {
    const transport = transportOf({ post: { id: 41, updated_at: STAMP } })
    const draft = op({ op: 'fork', target: QUERY })
    await Promise.all([applyOperation(draft, 2, transport, OPTIONS), applyOperation(draft, 2, transport, OPTIONS)])
    const keys = transport.post.mock.calls.map((call) => (call[1] as { idempotency_key: string }).idempotency_key)
    expect(keys).toEqual(['d1:2:0', 'd1:2:0'])
  })

  it('takes the copy out of draft when drafts are off, as the editor does', async () => {
    const transport = transportOf({ post: { id: 41, updated_at: STAMP } })
    await applyOperation(op({ op: 'fork', target: QUERY }), 2, transport, { ...OPTIONS, queryDrafts: false })
    expect(transport.post.mock.calls[1].slice(0, 2)).toEqual(['queries/41', { is_draft: false }])
  })
})

describe('applyOperation: restore, favorite and share', () => {
  it('restores a dashboard through POST with the precondition', async () => {
    const transport = transportOf({ post: { id: 3, updated_at: STAMP } })
    await applyOperation(op({ op: 'restore', target: DASHBOARD, snapshot: { updatedAt: STAMP } }), 2, transport, OPTIONS)
    expect(transport.post.mock.calls[0].slice(0, 2)).toEqual([
      'dashboards/3',
      { is_archived: false, expected_updated_at: STAMP },
    ])
  })

  it('favorites with POST and unfavorites with DELETE on the plural path', async () => {
    const transport = transportOf()
    await applyOperation(op({ op: 'favorite', target: DASHBOARD }), 2, transport, OPTIONS)
    await applyOperation(op({ op: 'unfavorite', target: QUERY }), 2, transport, OPTIONS)
    expect(transport.post.mock.calls[0][0]).toBe('dashboards/3/favorite')
    expect(transport.del.mock.calls[0][0]).toBe('queries/7/favorite')
  })

  it('shares a dashboard with its expiry and hands back the public URL on this origin', async () => {
    const transport = transportOf({ post: { api_key: 'tok', public_url: 'http://redash/public/dashboards/tok' } })
    const later = '2026-12-01T00:00:00Z'
    const outcome = await applyOperation(op({ op: 'share', target: DASHBOARD, params: { expiresAt: later } }), 2, transport, OPTIONS)
    expect(transport.post.mock.calls[0].slice(0, 2)).toEqual(['dashboards/3/share', { expires_at: later }])
    expect(outcome).toMatchObject({ status: 'done', result: { publicUrl: `${window.location.origin}/dashboards/public/tok` } })
  })

  it('publishes a chart with its refresh cadence on the embed URL, and records the query', async () => {
    const transport = transportOf({ post: { api_key: 'tok' } })
    const outcome = await applyOperation(
      op({ op: 'share', target: CHART, params: { expiresAt: null, refreshSeconds: 300 } }),
      2,
      transport,
      OPTIONS
    )
    expect(transport.post.mock.calls[0].slice(0, 2)).toEqual(['visualizations/31/share', {}])
    expect(chat.recordPromotion).toHaveBeenCalledWith('d1', expect.objectContaining({ targetType: 'query', targetId: '7' }))
    expect(outcome).toMatchObject({ result: { publicUrl: `${window.location.origin}/embed/public/tok?refresh=300` } })
  })

  it('revokes a chart link only when confirmed', async () => {
    const transport = transportOf()
    const draft = op({ op: 'revoke', target: CHART, destructive: true })
    expect(await applyOperation(draft, 2, transport, OPTIONS)).toEqual({ status: 'failed', error: CONFIRM_FIRST })
    await applyOperation(draft, 2, transport, { ...OPTIONS, confirmed: true })
    expect(transport.del.mock.calls[0][0]).toBe('visualizations/31/share')
  })

  it('records a failed write and says why', async () => {
    const transport = transportOf({ post: new ApiError(403, 'Forbidden') })
    const outcome = await applyOperation(op({ op: 'favorite', target: QUERY }), 2, transport, OPTIONS)
    expect(outcome).toMatchObject({ status: 'failed' })
    expect(chat.patchPromotion).toHaveBeenCalledWith('d1', 'p1', expect.objectContaining({ status: 'failed' }))
  })
})
