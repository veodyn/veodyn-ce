// The write logic behind usePromoteDraft's "save" and "update" actions, lifted
// out into plain async functions so a dashboard promotion (usePromoteDashboardDraft)
// can call it a variable number of times in one click — once per unpromoted
// query-draft item — without violating the rule that a hook is called a fixed
// number of times per render (root CLAUDE.md's hook-extraction rule; the
// worked example there is query-editor-page.tsx / use-query-buffer.ts, the
// same principle applied here to a promotion write instead of component state).
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

/** Write a query draft's latest version (create query + visualization) and
 * record the promotion. Not idempotent against a draft already promoted —
 * callers that need "promote only if not already promoted" check
 * `draft.promotions` themselves first (usePromoteDashboardDraft does, since
 * an already-promoted item there is resolved to its existing visualization
 * instead of writing a second query). */
export async function promoteQueryDraft(write: WriteProposedQuery, draft: DraftView): Promise<QueryDraftPromotion> {
  const latest = draft.versions[draft.versions.length - 1]
  if (!latest) throw new Error('this draft has no version to save')
  const written = await write(latest.payload, latest.payload.dataSourceId)
  const stored = await queriesService.get(written.queryId)
  const promotion = await recordQueryPromotion(draft, written.queryId, stored?.version)
  return { queryId: written.queryId, visualizationId: written.visualizationId, promotion }
}
