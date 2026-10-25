import { describe, expect, it } from 'vitest'
import type { PromotionPatch } from '@/services/ai/chat-client'
import { emptyThread, type ThreadState } from './thread-model'
import { carryQueryDraftSync, holdQueryDraftSync } from './thread-sync'
import type { ChatPromotion } from './wire'

const PAYLOAD = { name: 'Trips', description: '', sql: 'SELECT 1', dataSourceId: 5, vizChoiceId: 'chart-bar', vizOptions: {} }
const QUERY_DONE = { step: 0, outcome: 'done' as const, targetId: '44' }
const CHART_FAILED = { step: 1, outcome: 'failed' as const, error: 'chart refused' }
const CHART_DONE = { step: 1, outcome: 'done' as const, targetId: '9' }

function stored(over: Partial<ChatPromotion>): ChatPromotion {
  return {
    id: 'p1',
    targetType: 'query',
    targetId: '44',
    promotedVersion: 1,
    targetVersionAtPromote: null,
    status: 'done',
    receipts: [QUERY_DONE],
    createdAt: 'x',
    updatedAt: 'x',
    ...over,
  }
}

function thread(promotions: ChatPromotion[]): ThreadState {
  return { ...emptyThread(), drafts: { q1: { id: 'q1', versions: [{ version: 1, payload: PAYLOAD }], promotions } } }
}

function held(promotion: ChatPromotion, patch: PromotionPatch) {
  return { promotion, patch }
}

describe('holding a query draft record against what the server already stores', () => {
  it('keeps a done patch whose stored promotion is still partial, as after a chart retry whose PATCH was lost', () => {
    const partial = stored({ status: 'partial', receipts: [QUERY_DONE, CHART_FAILED] })
    const patch: PromotionPatch = { status: 'done', targetId: '44', receipts: [QUERY_DONE, CHART_DONE] }
    const next = holdQueryDraftSync(thread([partial]), 'q1', held({ ...partial, ...patch } as ChatPromotion, patch))
    expect(next.queryDraftSync.q1?.patch).toEqual(patch)
  })

  it('keeps a partial patch recorded against a promotion the server stores as done', () => {
    const done = stored({})
    const patch: PromotionPatch = { status: 'partial', targetId: '44', receipts: [QUERY_DONE, CHART_FAILED] }
    const next = holdQueryDraftSync(thread([done]), 'q1', held(done, patch))
    expect(next.queryDraftSync.q1?.patch).toEqual(patch)
  })

  it('drops a record the server already stores exactly', () => {
    const done = stored({})
    const patch: PromotionPatch = { status: 'done', targetId: '44', receipts: [QUERY_DONE] }
    const state = thread([done])
    expect(holdQueryDraftSync(state, 'q1', held(done, patch))).toBe(state)
  })

  it('drops a record a later applied promotion of the draft has overtaken', () => {
    const pending = stored({ status: 'pending', targetId: null, receipts: [] })
    const later = stored({ id: 'p2', targetId: '45' })
    const patch: PromotionPatch = { status: 'done', targetId: '44', receipts: [QUERY_DONE] }
    const state = thread([pending, later])
    expect(holdQueryDraftSync(state, 'q1', held(pending, patch))).toBe(state)
  })

  it('holds the promotion with its patch merged in, so readers see the state the retry will record', () => {
    const done = stored({})
    const patch: PromotionPatch = { status: 'partial', targetId: '44', receipts: [QUERY_DONE, CHART_FAILED] }
    const next = holdQueryDraftSync(thread([]), 'q1', held(done, patch))
    expect(next.queryDraftSync.q1?.promotion).toMatchObject({ id: 'p1', status: 'partial', receipts: [QUERY_DONE, CHART_FAILED] })
    expect(next.queryDraftSync.q1?.patch).toEqual(patch)
  })

  it('a reload keeps a hold the stored record does not match yet, and drops one it matches', () => {
    const partial = stored({ status: 'partial', receipts: [QUERY_DONE, CHART_FAILED] })
    const patch: PromotionPatch = { status: 'done', targetId: '44', receipts: [QUERY_DONE, CHART_DONE] }
    const current = holdQueryDraftSync(thread([]), 'q1', held(partial, patch))
    expect(carryQueryDraftSync(thread([partial]), current).queryDraftSync.q1?.patch).toEqual(patch)
    const matching = stored({ receipts: [QUERY_DONE, CHART_DONE] })
    expect(carryQueryDraftSync(thread([matching]), current).queryDraftSync.q1).toBeUndefined()
  })
})
