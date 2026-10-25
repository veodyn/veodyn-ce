import type { useWriteProposedQuery } from '@/components/chat/proposal-kit/use-write-proposed-query'
import { pickVisualization } from '@/lib/chat/library-results'
import type { DraftView } from '@/lib/chat/thread-model'
import { lastApplied } from '@/lib/chat/promotions'
import type { QueryDraftSync } from '@/lib/chat/thread-sync'
import type { ChatPromotion } from '@/lib/chat/wire'
import { readQueryError } from '@/lib/query-error'
import { patchPromotion } from '@/services/ai/chat-client'
import * as queriesService from '@/services/redash/queries'
import { VISUALIZATION_STEP, writeChart } from './promote-dashboard-chart'
import { promoteQueryDraft } from './promote-query-draft'

export interface ResolvedChart {
  queryId: number
  visualizationId: number
  visualizationType?: string
}

export type ChartResolution = ResolvedChart | { reason: string } | null

export type QueryPromoted = (draftId: string, promotion: ChatPromotion) => void

export type QueryDraftHold = Pick<QueryDraftSync, 'held' | 'hold'>

type WriteQuery = ReturnType<typeof useWriteProposedQuery>['write']

async function typeOf(queryId: number, visualizationId: number): Promise<string | undefined> {
  const query = await queriesService.get(queryId).catch(() => null)
  return query?.visualizations.find((one) => one.id === visualizationId)?.type
}

async function retryChart(
  queryDraft: DraftView,
  promoted: ChatPromotion,
  queryId: number,
  onQueryPromoted: QueryPromoted,
  querySync: QueryDraftHold
): Promise<ChartResolution> {
  const proposal = queryDraft.versions.find((one) => one.version === promoted.promotedVersion)
  if (!proposal) return { reason: 'chart not created: its proposal is gone' }
  try {
    const visualizationId = await writeChart(queryDraft, promoted, queryId, proposal)
    const receipts = [
      ...promoted.receipts.filter((receipt) => receipt.step !== VISUALIZATION_STEP),
      { step: VISUALIZATION_STEP, outcome: 'done' as const, targetId: String(visualizationId) },
    ]
    const patch = { status: 'done' as const, targetId: String(queryId), receipts }
    await patchPromotion(queryDraft.id, promoted.id, patch).then(
      (recorded) => onQueryPromoted(queryDraft.id, recorded),
      () => querySync.hold(queryDraft.id, { promotion: { ...promoted, ...patch }, patch })
    )
    return { queryId, visualizationId, visualizationType: await typeOf(queryId, visualizationId) }
  } catch (cause) {
    return { reason: `chart not created: ${readQueryError(cause).message}` }
  }
}

export async function resolveDraftChart(
  write: WriteQuery,
  queryDraft: DraftView | undefined,
  onQueryPromoted: QueryPromoted,
  querySync: QueryDraftHold
): Promise<ChartResolution> {
  if (!queryDraft) return null
  const promoted = querySync.held[queryDraft.id]?.promotion ?? lastApplied(queryDraft.promotions)
  if (promoted?.status === 'partial' && promoted.receipts.some((r) => r.step === VISUALIZATION_STEP && r.outcome === 'failed')) {
    return retryChart(queryDraft, promoted, Number(promoted.targetId), onQueryPromoted, querySync)
  }
  if (promoted) {
    const queryId = Number(promoted.targetId)
    const query = await queriesService.get(queryId).catch(() => null)
    if (!query) return null
    const visualization = pickVisualization(query, null)
    return typeof visualization === 'string'
      ? null
      : { queryId, visualizationId: visualization.id, visualizationType: visualization.type }
  }
  const written = await promoteQueryDraft(write, queryDraft)
  if (written.unsynced) querySync.hold(queryDraft.id, { promotion: written.promotion, patch: written.unsynced })
  else onQueryPromoted(queryDraft.id, written.promotion)
  if (written.visualizationId === null) return null
  return {
    queryId: written.queryId,
    visualizationId: written.visualizationId,
    visualizationType: await typeOf(written.queryId, written.visualizationId),
  }
}

export async function resolveExistingChart(queryId: number, visualizationId: number): Promise<ChartResolution> {
  const query = await queriesService.get(queryId).catch(() => null)
  const found = query?.visualizations.find((one) => one.id === visualizationId)
  return found ? { queryId, visualizationId, visualizationType: found.type } : null
}
