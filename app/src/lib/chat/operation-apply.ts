import { readQueryError } from '@/lib/query-error'
import { recordPromotion, type PromotionPatch } from '@/services/ai/chat-client'
import { ApiError } from '@/services/api-client'
import { isDestructive, type OperationPayload } from './operation-changes'
import { operationPublicUrl } from './operation-links'
import { forkQuery, publishFork, writeOperation } from './operation-writes'
import { abandonPromotion, finishPromotion, idempotencyKey, type PromotionReceipt } from './promotion-lifecycle'
import type { Draft } from './thread-model'
import type { RedashTransport } from './transport'
import type { ChatPromotion } from './wire'

export type OperationDraft = Draft<OperationPayload>

export const CONFIRM_FIRST = 'This change needs the second confirmation before it applies.'
export const NO_SUCH_VERSION = 'This operation has no such version.'
export const CHANGED_SINCE_READ = 'This changed after the chat read it.'

export interface OperationResult {
  forkId?: number
  publicUrl?: string
}

export type OperationOutcome =
  | { status: 'done'; promotion: ChatPromotion; result: OperationResult }
  | { status: 'unsynced'; promotion: ChatPromotion; patch: PromotionPatch; result: OperationResult }
  | { status: 'conflict' }
  | { status: 'failed'; error: string }

export interface ApplyOptions {
  confirmed: boolean
  overwrite: boolean
  queryDrafts: boolean
}

const FIRST_STEP = 0
const PUBLISH_STEP = 1

function promotionTarget(payload: OperationPayload): { targetType: 'query' | 'dashboard'; targetId: string } {
  const { target } = payload
  if (target.kind === 'dashboard') return { targetType: 'dashboard', targetId: String(target.id) }
  return { targetType: 'query', targetId: String(target.kind === 'visualization' ? target.queryId : target.id) }
}

interface Landed {
  targetId: string
  receipts: PromotionReceipt[]
  result: OperationResult
}

function receipt(step: number, targetId: number, updatedAt?: string): PromotionReceipt {
  return { step, outcome: 'done', targetId: String(targetId), ...(updatedAt ? { updatedAt } : {}) }
}

class PartialFork extends Error {
  constructor(
    readonly landed: Landed,
    readonly cause: unknown
  ) {
    super(readQueryError(cause).message)
  }
}

async function fork(
  draft: OperationDraft,
  version: number,
  payload: OperationPayload,
  transport: RedashTransport,
  queryDrafts: boolean
): Promise<Landed> {
  const copy = await forkQuery(transport, payload.target.id, idempotencyKey(draft.id, version, FIRST_STEP))
  const landed: Landed = {
    targetId: String(copy.id),
    receipts: [receipt(FIRST_STEP, copy.id, copy.updated_at)],
    result: { forkId: copy.id },
  }
  if (queryDrafts) return landed
  try {
    const published = await publishFork(transport, copy.id)
    return { ...landed, receipts: [...landed.receipts, receipt(PUBLISH_STEP, copy.id, published?.updated_at)] }
  } catch (error) {
    throw new PartialFork(landed, error)
  }
}

async function land(
  draft: OperationDraft,
  version: number,
  payload: OperationPayload,
  transport: RedashTransport,
  options: ApplyOptions,
  targetId: string
): Promise<Landed> {
  if (payload.op === 'fork') return fork(draft, version, payload, transport, options.queryDrafts)
  const written = await writeOperation(payload, transport, options.overwrite)
  const publicUrl = written.token ? operationPublicUrl(payload.target, payload.params, written.token) : undefined
  return {
    targetId,
    receipts: [receipt(FIRST_STEP, written.targetId, written.updatedAt)],
    result: publicUrl ? { publicUrl } : {},
  }
}

export async function applyOperation(
  draft: OperationDraft,
  version: number,
  transport: RedashTransport,
  options: ApplyOptions
): Promise<OperationOutcome> {
  const entry = draft.versions.find((one) => one.version === version)
  if (!entry) return { status: 'failed', error: NO_SUCH_VERSION }
  const { payload } = entry
  if (isDestructive(payload) && !options.confirmed) return { status: 'failed', error: CONFIRM_FIRST }
  const { targetType, targetId } = promotionTarget(payload)

  let promotion: ChatPromotion
  try {
    promotion = await recordPromotion(draft.id, { version, targetType, targetId, status: 'pending' })
  } catch (error) {
    return { status: 'failed', error: readQueryError(error).message }
  }

  try {
    const landed = await land(draft, version, payload, transport, options, targetId)
    const sync = await finishPromotion(draft.id, promotion, landed.targetId, landed.receipts)
    return sync.synced
      ? { status: 'done', promotion: sync.promotion, result: landed.result }
      : { status: 'unsynced', promotion: sync.promotion, patch: sync.patch, result: landed.result }
  } catch (error) {
    if (error instanceof PartialFork) {
      await abandonPromotion(draft.id, promotion, error.landed.receipts, PUBLISH_STEP, error.cause, error.landed.targetId)
      return { status: 'failed', error: error.message }
    }
    const conflict = error instanceof ApiError && error.status === 409 && payload.snapshot !== undefined
    await abandonPromotion(draft.id, promotion, [], FIRST_STEP, conflict ? new Error(CHANGED_SINCE_READ) : error)
    return conflict ? { status: 'conflict' } : { status: 'failed', error: readQueryError(error).message }
  }
}

export const NOT_A_PARTIAL_FORK = 'Only a fork whose copy is still a draft can be finished.'

function partialForkId(draft: OperationDraft, promotion: ChatPromotion): number | null {
  const forkId = Number(promotion.targetId)
  const entry = draft.versions.find((one) => one.version === promotion.promotedVersion)
  if (promotion.status !== 'partial' || entry?.payload.op !== 'fork') return null
  return Number.isInteger(forkId) && forkId > 0 ? forkId : null
}

export async function finishFork(
  draft: OperationDraft,
  promotion: ChatPromotion,
  transport: RedashTransport
): Promise<OperationOutcome> {
  const forkId = partialForkId(draft, promotion)
  if (forkId === null) return { status: 'failed', error: NOT_A_PARTIAL_FORK }
  let published: { updated_at?: string } | undefined
  try {
    published = await publishFork(transport, forkId)
  } catch (error) {
    return { status: 'failed', error: readQueryError(error).message }
  }
  const kept = promotion.receipts.filter((one) => one.outcome === 'done' && one.step !== PUBLISH_STEP)
  const receipts = [...kept, receipt(PUBLISH_STEP, forkId, published?.updated_at)]
  const sync = await finishPromotion(draft.id, promotion, String(forkId), receipts)
  const result = { forkId }
  return sync.synced
    ? { status: 'done', promotion: sync.promotion, result }
    : { status: 'unsynced', promotion: sync.promotion, patch: sync.patch, result }
}
