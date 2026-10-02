import type { useWriteProposedQuery } from '@/components/ai/create-chat/proposals/use-write-proposed-query'
import type { DraftView } from '@/lib/chat/thread-model'
import type { ChatPromotion } from '@/lib/chat/wire'
import { recordPromotion } from '@/services/ai/chat-client'
import * as queriesService from '@/services/redash/queries'

export type WriteProposedQuery = ReturnType<typeof useWriteProposedQuery>['write']

export interface QueryDraftPromotion {
  queryId: number
  visualizationId: number | null
  promotion: ChatPromotion
}

export async function recordQueryPromotion(
  draft: DraftView,
  queryId: number,
  version: number | undefined
): Promise<ChatPromotion> {
  const latest = draft.versions[draft.versions.length - 1]
  if (!latest) throw new Error('this draft has no version to save')
  return recordPromotion(draft.id, {
    version: latest.version,
    targetType: 'query',
    targetId: String(queryId),
    targetVersionAtPromote: version ?? null,
  })
}

export async function promoteQueryDraft(write: WriteProposedQuery, draft: DraftView): Promise<QueryDraftPromotion> {
  const latest = draft.versions[draft.versions.length - 1]
  if (!latest) throw new Error('this draft has no version to save')
  const written = await write(latest.payload, latest.payload.dataSourceId)
  const stored = await queriesService.get(written.queryId)
  const promotion = await recordQueryPromotion(draft, written.queryId, stored?.version)
  return { queryId: written.queryId, visualizationId: written.visualizationId, promotion }
}
