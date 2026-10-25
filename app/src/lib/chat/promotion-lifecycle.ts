import { readQueryError } from '@/lib/query-error'
import { patchPromotion, type PromotionPatch } from '@/services/ai/chat-client'
import type { components } from '@/types/generated/veodyn-api'
import type { ChatPromotion } from './wire'

export type PromotionReceipt = components['schemas']['ChatPromotionReceipt']

const MAX_ERROR_CHARS = 500

export type PromotionSync =
  | { synced: true; promotion: ChatPromotion }
  | { synced: false; promotion: ChatPromotion; patch: PromotionPatch }

export function idempotencyKey(draftId: string, version: number, step: number): string {
  return `${draftId}:${version}:${step}`
}

export async function finishPromotion(
  draftId: string,
  promotion: ChatPromotion,
  targetId: string,
  receipts: PromotionReceipt[],
  targetVersionAtPromote: number | null = null
): Promise<PromotionSync> {
  const patch: PromotionPatch = {
    status: 'done',
    targetId,
    receipts,
    ...(targetVersionAtPromote === null ? {} : { targetVersionAtPromote }),
  }
  try {
    return { synced: true, promotion: await patchPromotion(draftId, promotion.id, patch) }
  } catch {
    return { synced: false, promotion: { ...promotion, ...patch } as ChatPromotion, patch }
  }
}

export async function abandonPromotion(
  draftId: string,
  promotion: ChatPromotion,
  receipts: PromotionReceipt[],
  step: number,
  cause: unknown,
  targetId: string | null = null
): Promise<void> {
  const error = readQueryError(cause).message.slice(0, MAX_ERROR_CHARS)
  const failure: PromotionReceipt = { step, outcome: 'failed', error }
  await patchPromotion(draftId, promotion.id, {
    status: targetId === null ? 'failed' : 'partial',
    ...(targetId === null ? {} : { targetId }),
    receipts: [...receipts, failure],
  }).catch(() => undefined)
}
