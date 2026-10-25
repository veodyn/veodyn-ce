import { idempotencyKey } from '@/lib/chat/promotion-lifecycle'
import type { DraftView } from '@/lib/chat/thread-model'
import { sanitizedVizOptions } from '@/lib/chat/viz-options'
import type { ChatPromotion } from '@/lib/chat/wire'
import { resolveVizChoice } from '@/lib/viz-choices'
import * as queriesService from '@/services/redash/queries'
import { createVisualization, updateVisualization } from '@/services/redash/visualizations'

export const VISUALIZATION_STEP = 1

async function existingVisualization(queryId: number, visualizationId: number) {
  const query = await queriesService.get(queryId)
  return query?.visualizations.find((one) => one.id === visualizationId)
}

export async function writeChart(
  queryDraft: DraftView,
  promoted: ChatPromotion,
  queryId: number,
  proposal: DraftView['versions'][number]
): Promise<number> {
  const choice = resolveVizChoice(proposal.payload.vizChoiceId)
  const failedStep = promoted.receipts.find((r) => r.step === VISUALIZATION_STEP && r.outcome === 'failed')
  const updatedId = failedStep?.targetId ? Number(failedStep.targetId) : null
  const authored = sanitizedVizOptions(choice.type, proposal.payload.vizOptions)
  const existing = updatedId === null ? undefined : await existingVisualization(queryId, updatedId)
  if (existing) {
    await updateVisualization(existing.id, {
      name: choice.label,
      options: { ...existing.options, ...choice.options, ...authored },
    })
    return existing.id
  }
  const created = await createVisualization({
    query_id: queryId,
    type: choice.type,
    name: choice.label,
    options: { ...choice.options, ...authored },
    idempotency_key: idempotencyKey(queryDraft.id, proposal.version, VISUALIZATION_STEP),
  })
  return created.id
}
