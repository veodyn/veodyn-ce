import type { useWriteProposedQuery } from '@/components/chat/proposal-kit/use-write-proposed-query'
import { abandonPromotion, finishPromotion, idempotencyKey, type PromotionReceipt } from '@/lib/chat/promotion-lifecycle'
import type { DraftView } from '@/lib/chat/thread-model'
import type { ChatPromotion } from '@/lib/chat/wire'
import { recordPromotion, type PromotionPatch } from '@/services/ai/chat-client'
import * as queriesService from '@/services/redash/queries'

export type WriteProposedQuery = ReturnType<typeof useWriteProposedQuery>['write']

export interface QueryDraftPromotion {
  queryId: number
  visualizationId: number | null
  promotion: ChatPromotion
  unsynced: PromotionPatch | null
}

const QUERY_STEP = 0
const VISUALIZATION_STEP = 1

export async function promoteQueryDraft(write: WriteProposedQuery, draft: DraftView): Promise<QueryDraftPromotion> {
  const latest = draft.versions[draft.versions.length - 1]
  if (!latest) throw new Error('this draft has no version to save')
  const pending = await recordPromotion(draft.id, { version: latest.version, targetType: 'query', status: 'pending' })
  let written: Awaited<ReturnType<WriteProposedQuery>>
  let createdQueryId: number | null = null
  try {
    written = await write(latest.payload, latest.payload.dataSourceId, {
      onCreated: (queryId) => {
        createdQueryId = queryId
      },
      idempotencyKeys: {
        query: idempotencyKey(draft.id, latest.version, QUERY_STEP),
        visualization: idempotencyKey(draft.id, latest.version, VISUALIZATION_STEP),
      },
    })
  } catch (error) {
    if (createdQueryId === null) {
      await abandonPromotion(draft.id, pending, [], QUERY_STEP, error)
    } else {
      const targetId = String(createdQueryId)
      const created: PromotionReceipt = { step: QUERY_STEP, outcome: 'done', targetId }
      await abandonPromotion(draft.id, pending, [created], VISUALIZATION_STEP, error, targetId)
    }
    throw error
  }
  const targetId = String(written.queryId)
  const stored = await queriesService.get(written.queryId)
  const receipts: PromotionReceipt[] = [
    { step: QUERY_STEP, outcome: 'done', targetId, updatedAt: stored?.updated_at },
    written.visualizationId === null
      ? { step: VISUALIZATION_STEP, outcome: 'skipped' }
      : { step: VISUALIZATION_STEP, outcome: 'done', targetId: String(written.visualizationId) },
  ]
  const sync = await finishPromotion(draft.id, pending, targetId, receipts)
  return {
    queryId: written.queryId,
    visualizationId: written.visualizationId,
    promotion: sync.promotion,
    unsynced: sync.synced ? null : sync.patch,
  }
}
