import { readQueryError } from '@/lib/query-error'
import { patchPromotion, recordPromotion, type PromotionPatch } from '@/services/ai/chat-client'
import { ApiError } from '@/services/api-client'
import * as nodeCalls from './node-calls'
import { idempotencyKey } from './promotion-lifecycle'
import type { ApplyOutcome } from './query-edit-apply'
import type { Draft } from './thread-model'
import type { RedashTransport } from './transport'
import type { VizPayload } from './viz-changes'
import type { ChatPromotion } from './wire'

export type VizDraft = Draft<VizPayload>

export const CHANGED_SINCE_READ = 'This visualization changed after the chat read it.'
export const NO_SUCH_VERSION = 'This change has no such version.'

const FIRST_STEP = 0
const MAX_ERROR_CHARS = 500

interface Written {
  visualizationId: number
  updatedAt?: string
}

async function write(
  draft: VizDraft,
  version: number,
  payload: VizPayload,
  transport: RedashTransport,
  overwrite: boolean
): Promise<Written> {
  if (payload.mode === 'new') {
    const created = await nodeCalls.createVisualization(transport, {
      query_id: payload.queryId,
      ...payload.next,
      idempotency_key: idempotencyKey(draft.id, version, FIRST_STEP),
    })
    return { visualizationId: created.id, updatedAt: created.updated_at }
  }
  const expected = overwrite ? undefined : payload.snapshot.updatedAt
  if (payload.mode === 'edit') {
    const saved = await nodeCalls.updateVisualization(transport, payload.visualizationId, payload.next, expected)
    return { visualizationId: payload.visualizationId, updatedAt: saved.updated_at }
  }
  await nodeCalls.deleteVisualization(transport, payload.visualizationId, expected)
  return { visualizationId: payload.visualizationId }
}

async function settle(draftId: string, promotion: ChatPromotion, patch: PromotionPatch): Promise<void> {
  try {
    await patchPromotion(draftId, promotion.id, patch)
  } catch {
    return
  }
}

export async function applyVizChange(
  draft: VizDraft,
  version: number,
  transport: RedashTransport,
  { overwrite }: { overwrite: boolean }
): Promise<ApplyOutcome> {
  const entry = draft.versions.find((one) => one.version === version)
  if (!entry) return { status: 'failed', error: NO_SUCH_VERSION }
  const { payload } = entry
  const targetId = String(payload.queryId)

  let promotion: ChatPromotion
  try {
    promotion = await recordPromotion(draft.id, { version, targetType: 'query', targetId, status: 'pending' })
  } catch (error) {
    return { status: 'failed', error: readQueryError(error).message }
  }

  try {
    const written = await write(draft, version, payload, transport, overwrite)
    const receipt = {
      step: FIRST_STEP,
      outcome: 'done' as const,
      targetId: String(written.visualizationId),
      ...(written.updatedAt ? { updatedAt: written.updatedAt } : {}),
    }
    const patch: PromotionPatch = { status: 'done', targetId, receipts: [receipt] }
    try {
      return { status: 'done', promotion: await patchPromotion(draft.id, promotion.id, patch) }
    } catch {
      return { status: 'unsynced', promotion: { ...promotion, ...patch } as ChatPromotion, patch }
    }
  } catch (error) {
    const conflict = error instanceof ApiError && error.status === 409
    const message = (conflict ? CHANGED_SINCE_READ : readQueryError(error).message).slice(0, MAX_ERROR_CHARS)
    await settle(draft.id, promotion, {
      status: 'failed',
      receipts: [{ step: FIRST_STEP, outcome: 'failed', error: message }],
    })
    return conflict ? { status: 'conflict' } : { status: 'failed', error: message }
  }
}
