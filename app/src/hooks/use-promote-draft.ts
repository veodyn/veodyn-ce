'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useWriteProposedQuery } from '@/components/chat/proposal-kit/use-write-proposed-query'
import { useCreateVisualization, useUpdateVisualization } from '@/hooks/use-visualizations'
import { idempotencyKey } from '@/lib/chat/promotion-lifecycle'
import { lastApplied } from '@/lib/chat/promotions'
import { fetchQuery, snapshotOf } from '@/lib/chat/query-detail'
import { applyQueryEdit, diffQuery, type EditDraft } from '@/lib/chat/query-edit'
import { sanitizedVizOptions } from '@/lib/chat/viz-options'
import type { DraftView } from '@/lib/chat/thread-model'
import type { QueryDraftSync } from '@/lib/chat/thread-sync'
import { browserTransport } from '@/lib/chat/transport'
import type { ChatPromotion } from '@/lib/chat/wire'
import { patchPromotion, type PromotionPatch } from '@/services/ai/chat-client'
import { readQueryError } from '@/lib/query-error'
import { DEFAULT_VIZ_ID, resolveVizChoice } from '@/lib/viz-choices'
import type { RedashQuery } from '@/services/redash/types'
import { promoteQueryDraft } from './promote-query-draft'

export const QUERY_GONE_MESSAGE = 'The saved query no longer exists. Save the draft as a new query instead.'
export const CHART_NOT_UPDATED_MESSAGE = 'The query was updated, but its chart could not be changed'

const VISUALIZATION_STEP = 1
const MAX_ERROR_CHARS = 500

export type PromoteStatus = 'idle' | 'saving' | 'conflict'

export interface DraftPromotion {
  status: PromoteStatus
  error: string | null
  unsynced: boolean
  save: () => void
  update: (overwrite: boolean) => void
  retryChart: () => void
  retrySync: () => void
  keep: () => void
}

type Promoted = (draftId: string, promotion: ChatPromotion) => void

function lastStamp(promotion: ChatPromotion): string | undefined {
  return promotion.receipts.findLast((receipt) => receipt.updatedAt)?.updatedAt ?? undefined
}

export function usePromoteDraft(draft: DraftView, onPromoted: Promoted, querySync: QueryDraftSync): DraftPromotion {
  const { write } = useWriteProposedQuery()
  const queryClient = useQueryClient()
  const createVisualization = useCreateVisualization()
  const updateVisualization = useUpdateVisualization()
  const [status, setStatus] = useState<PromoteStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const latest = draft.versions[draft.versions.length - 1]
  const promotion = lastApplied(draft.promotions)

  const { hold: holdSync, retry: retryHeld } = querySync
  const hold = useCallback(
    (held: ChatPromotion, patch: PromotionPatch) => holdSync(draft.id, { promotion: held, patch }),
    [holdSync, draft.id]
  )
  const retrySync = useCallback(() => void retryHeld(draft.id), [retryHeld, draft.id])

  const fail = useCallback((cause: unknown) => {
    setError(readQueryError(cause).message)
    setStatus('idle')
  }, [])

  const record = useCallback(
    async (target: ChatPromotion, patch: PromotionPatch) => {
      try {
        onPromoted(draft.id, await patchPromotion(draft.id, target.id, patch))
      } catch {
        hold({ ...target, ...patch } as ChatPromotion, patch)
      }
    },
    [draft.id, onPromoted, hold]
  )

  const save = useCallback(() => {
    if (!latest) return
    setStatus('saving')
    setError(null)
    promoteQueryDraft(write, draft)
      .then((written) => {
        if (written.unsynced) hold(written.promotion, written.unsynced)
        else onPromoted(draft.id, written.promotion)
        setStatus('idle')
      })
      .catch(fail)
  }, [latest, write, draft, onPromoted, hold, fail])

  const existingChart = useCallback(
    (current: RedashQuery) => {
      if (!latest) return null
      const choice = resolveVizChoice(latest.payload.vizChoiceId)
      const authored = sanitizedVizOptions(choice.type, latest.payload.vizOptions)
      if (choice.id === DEFAULT_VIZ_ID && Object.keys(authored).length === 0) return null
      return (current.visualizations ?? []).find((one) => one.type === choice.type) ?? null
    },
    [latest]
  )

  const updateChart = useCallback(
    async (queryId: number, current: RedashQuery): Promise<number | null> => {
      if (!latest) return null
      const choice = resolveVizChoice(latest.payload.vizChoiceId)
      const authored = sanitizedVizOptions(choice.type, latest.payload.vizOptions)
      const isTable = choice.id === DEFAULT_VIZ_ID
      if (isTable && Object.keys(authored).length === 0) return null
      const existing = existingChart(current)
      if (existing) {
        await updateVisualization.mutateAsync({
          queryId,
          vizId: existing.id,
          ...(isTable ? {} : { name: choice.label }),
          options: { ...existing.options, ...choice.options, ...authored },
        })
        return existing.id
      }
      const created = await createVisualization.mutateAsync({
        queryId,
        type: choice.type,
        name: choice.label,
        options: { ...choice.options, ...authored },
        idempotencyKey: idempotencyKey(draft.id, latest.version, VISUALIZATION_STEP),
      })
      return created.id
    },
    [latest, draft.id, existingChart, updateVisualization, createVisualization]
  )

  const update = useCallback(
    (overwrite: boolean) => {
      if (!latest || !promotion) return
      const queryId = Number(promotion.targetId)
      setStatus('saving')
      setError(null)
      const run = async () => {
        const current = await fetchQuery(browserTransport, queryId)
        if (!current) {
          setError(QUERY_GONE_MESSAGE)
          setStatus('idle')
          return
        }
        const stamp = lastStamp(promotion)
        if (stamp === undefined && !overwrite && Date.parse(current.updated_at) > Date.parse(promotion.createdAt)) {
          setStatus('conflict')
          return
        }
        const snapshot = { ...snapshotOf(current), updatedAt: stamp ?? current.updated_at }
        const { payload } = latest
        const changes = diffQuery(snapshot, {
          name: payload.name,
          description: payload.description,
          sql: payload.sql,
          ...(payload.parameters ? { parameters: payload.parameters } : {}),
        })
        const edit: EditDraft = {
          id: draft.id,
          versions: [{ version: latest.version, payload: { queryId, snapshot, changes } }],
          promotions: draft.promotions,
        }
        const outcome = await applyQueryEdit(edit, latest.version, browserTransport, { overwrite })
        if (outcome.status === 'conflict') {
          setStatus('conflict')
          return
        }
        if (outcome.status === 'failed') {
          setError(outcome.error)
          setStatus('idle')
          return
        }
        void queryClient.invalidateQueries({ queryKey: ['queries'] })
        void queryClient.invalidateQueries({ queryKey: ['query', queryId] })
        let chartFailure: PromotionReceipt | null = null
        try {
          await updateChart(queryId, current)
        } catch (cause) {
          const message = readQueryError(cause).message
          setError(`${CHART_NOT_UPDATED_MESSAGE}: ${message}`)
          const target = existingChart(current)
          chartFailure = {
            step: VISUALIZATION_STEP,
            outcome: 'failed',
            error: message.slice(0, MAX_ERROR_CHARS),
            ...(target ? { targetId: String(target.id) } : {}),
          }
        }
        if (outcome.status === 'unsynced') {
          const patch: PromotionPatch = chartFailure
            ? {
                status: 'partial',
                targetId: outcome.patch.targetId,
                receipts: [...(outcome.patch.receipts ?? []), chartFailure],
              }
            : outcome.patch
          hold(outcome.promotion, patch)
        } else if (chartFailure) {
          onPromoted(draft.id, outcome.promotion)
          await record(outcome.promotion, { status: 'partial', receipts: [...outcome.promotion.receipts, chartFailure] })
        } else {
          onPromoted(draft.id, outcome.promotion)
        }
        setStatus('idle')
      }
      run().catch(fail)
    },
    [latest, promotion, draft, onPromoted, updateChart, existingChart, queryClient, record, hold, fail]
  )

  const retryChart = useCallback(() => {
    if (!latest || !promotion) return
    const queryId = Number(promotion.targetId)
    setStatus('saving')
    setError(null)
    const run = async () => {
      const current = await fetchQuery(browserTransport, queryId)
      if (!current) {
        setError(QUERY_GONE_MESSAGE)
        setStatus('idle')
        return
      }
      const vizId = await updateChart(queryId, current)
      const receipts = [
        ...promotion.receipts.filter((receipt) => receipt.step !== VISUALIZATION_STEP),
        { step: VISUALIZATION_STEP, outcome: 'done' as const, ...(vizId === null ? {} : { targetId: String(vizId) }) },
      ]
      await record(promotion, { status: 'done', receipts })
      void queryClient.invalidateQueries({ queryKey: ['query', queryId] })
      setStatus('idle')
    }
    run().catch((cause: unknown) => {
      setError(`${CHART_NOT_UPDATED_MESSAGE}: ${readQueryError(cause).message}`)
      setStatus('idle')
    })
  }, [latest, promotion, updateChart, record, queryClient])

  const keep = useCallback(() => setStatus('idle'), [])

  return {
    status,
    error,
    unsynced: querySync.held[draft.id] !== undefined,
    save,
    update,
    retryChart,
    retrySync,
    keep,
  }
}

type PromotionReceipt = NonNullable<PromotionPatch['receipts']>[number]
