import type { PromotionPatch } from '@/services/ai/chat-client'
import { isApplied } from './promotions'
import { addPromotion, type DraftView, type ThreadState } from './thread-model'
import type { ChatPromotion } from './wire'

export interface HeldQuerySync {
  promotion: ChatPromotion
  patch: PromotionPatch
}

export type QueryDraftSyncs = Readonly<Record<string, HeldQuerySync>>

export interface QueryDraftSync {
  held: QueryDraftSyncs
  hold(queryDraftId: string, held: HeldQuerySync): void
  retry(queryDraftId: string): Promise<ChatPromotion | null>
}

export function heldQueryId(held: HeldQuerySync | undefined): number | null {
  const id = Number(held?.patch.targetId ?? held?.promotion.targetId)
  return Number.isInteger(id) && id > 0 ? id : null
}

type Receipt = ChatPromotion['receipts'][number]

function sameReceipt(left: Receipt, right: Receipt): boolean {
  return (
    left.step === right.step &&
    left.outcome === right.outcome &&
    (left.targetId ?? null) === (right.targetId ?? null) &&
    (left.error ?? null) === (right.error ?? null) &&
    (left.updatedAt ?? null) === (right.updatedAt ?? null)
  )
}

function recordsPatch(stored: ChatPromotion, patch: PromotionPatch): boolean {
  if (patch.status !== undefined && stored.status !== patch.status) return false
  if (patch.targetId !== undefined && stored.targetId !== patch.targetId) return false
  const receipts = patch.receipts
  if (receipts === undefined || receipts === null) return true
  return receipts.length === stored.receipts.length && receipts.every((one, at) => sameReceipt(one, stored.receipts[at] as Receipt))
}

function settledOnServer(promotions: readonly ChatPromotion[], held: HeldQuerySync): boolean {
  const at = promotions.findIndex((one) => one.id === held.promotion.id)
  if (at === -1) return false
  const stored = promotions[at] as ChatPromotion
  return recordsPatch(stored, held.patch) || promotions.slice(at + 1).some(isApplied)
}

function supersedes(incoming: ChatPromotion, held: HeldQuerySync): boolean {
  return incoming.id === held.promotion.id ? incoming.status !== 'pending' : isApplied(incoming)
}

function without(syncs: QueryDraftSyncs, draftId: string): Record<string, HeldQuerySync> {
  return Object.fromEntries(Object.entries(syncs).filter(([id]) => id !== draftId))
}

export function holdQueryDraftSync(state: ThreadState, draftId: string, held: HeldQuerySync): ThreadState {
  const draft = state.drafts[draftId]
  if (draft && settledOnServer(draft.promotions, held)) return state
  const effective = { promotion: { ...held.promotion, ...held.patch } as ChatPromotion, patch: held.patch }
  return { ...state, queryDraftSync: { ...state.queryDraftSync, [draftId]: effective } }
}

export function queryDraftPromoted(state: ThreadState, draftId: string, promotion: ChatPromotion): ThreadState {
  const held = state.queryDraftSync[draftId]
  const next = held && supersedes(promotion, held) ? { ...state, queryDraftSync: without(state.queryDraftSync, draftId) } : state
  return addPromotion(next, draftId, promotion)
}

export function settleQueryDraftSync(
  state: ThreadState,
  draftId: string,
  held: HeldQuerySync,
  synced: ChatPromotion
): ThreadState {
  if (state.queryDraftSync[draftId] !== held) return state
  return addPromotion({ ...state, queryDraftSync: without(state.queryDraftSync, draftId) }, draftId, synced)
}

export function carryQueryDraftSync(loaded: ThreadState, current: ThreadState): ThreadState {
  const carried: Record<string, HeldQuerySync> = {}
  for (const [draftId, held] of Object.entries(current.queryDraftSync)) {
    const draft: DraftView | undefined = loaded.drafts[draftId]
    if (!draft || !settledOnServer(draft.promotions, held)) carried[draftId] = held
  }
  return { ...loaded, queryDraftSync: carried }
}
