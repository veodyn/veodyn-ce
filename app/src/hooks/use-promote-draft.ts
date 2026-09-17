'use client'

import { useCallback, useState } from 'react'
import { useWriteProposedQuery } from '@/components/ai/create-chat/proposals/use-write-proposed-query'
import { useUpdateQuery } from '@/hooks/use-queries'
import { useCreateVisualization, useUpdateVisualization } from '@/hooks/use-visualizations'
import type { DraftView } from '@/lib/chat/thread-model'
import type { ChatPromotion } from '@/lib/chat/wire'
import { readQueryError } from '@/lib/query-error'
import { DEFAULT_VIZ_ID, resolveVizChoice } from '@/lib/viz-choices'
import { recordPromotion } from '@/services/ai/chat-client'
import * as queriesService from '@/services/redash/queries'

export const QUERY_GONE_MESSAGE = 'The saved query no longer exists. Save the draft as a new query instead.'

export type PromoteStatus = 'idle' | 'saving' | 'conflict'

export interface DraftPromotion {
  status: PromoteStatus
  error: string | null
  save: () => void
  update: (overwrite: boolean) => void
  keep: () => void
}

type Promoted = (draftId: string, promotion: ChatPromotion) => void

export function usePromoteDraft(draft: DraftView, dataSourceId: number | null, onPromoted: Promoted): DraftPromotion {
  const { write } = useWriteProposedQuery()
  const updateQuery = useUpdateQuery()
  const createVisualization = useCreateVisualization()
  const updateVisualization = useUpdateVisualization()
  const [status, setStatus] = useState<PromoteStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const latest = draft.versions[draft.versions.length - 1]
  const promotion = draft.promotions[draft.promotions.length - 1]

  const record = useCallback(
    async (queryId: number, version: number | undefined) => {
      if (!latest) return
      const saved = await recordPromotion(draft.id, {
        version: latest.version,
        targetType: 'query',
        targetId: String(queryId),
        targetVersionAtPromote: version ?? null,
      })
      onPromoted(draft.id, saved)
    },
    [draft.id, latest, onPromoted]
  )

  const fail = useCallback((cause: unknown) => {
    setError(readQueryError(cause).message)
    setStatus('idle')
  }, [])

  const save = useCallback(() => {
    if (!latest || dataSourceId === null) return
    setStatus('saving')
    setError(null)
    write(latest.payload, dataSourceId)
      .then(async (written) => {
        const stored = await queriesService.get(written.queryId)
        await record(written.queryId, stored?.version)
        setStatus('idle')
      })
      .catch(fail)
  }, [latest, dataSourceId, write, record, fail])

  const update = useCallback(
    (overwrite: boolean) => {
      if (!latest || !promotion) return
      const queryId = Number(promotion.targetId)
      setStatus('saving')
      setError(null)
      const run = async () => {
        const current = await queriesService.get(queryId)
        if (!current) {
          setError(QUERY_GONE_MESSAGE)
          setStatus('idle')
          return
        }
        const moved =
          promotion.targetVersionAtPromote !== null &&
          current.version !== undefined &&
          current.version !== promotion.targetVersionAtPromote
        if (moved && !overwrite) {
          setStatus('conflict')
          return
        }
        const { payload } = latest
        const updated = await updateQuery.mutateAsync({
          id: queryId,
          name: payload.name,
          description: payload.description,
          query: payload.sql,
          version: current.version,
        })
        const choice = resolveVizChoice(payload.vizChoiceId)
        if (choice.id !== DEFAULT_VIZ_ID) {
          const existing = current.visualizations.find((one) => one.type === choice.type)
          if (existing) {
            await updateVisualization.mutateAsync({
              queryId,
              vizId: existing.id,
              name: choice.label,
              options: { ...existing.options, ...choice.options },
            })
          } else {
            await createVisualization.mutateAsync({ queryId, type: choice.type, name: choice.label, options: choice.options })
          }
        }
        await record(queryId, updated.version)
        setStatus('idle')
      }
      run().catch(fail)
    },
    [latest, promotion, updateQuery, updateVisualization, createVisualization, record, fail]
  )

  const keep = useCallback(() => setStatus('idle'), [])

  return { status, error, save, update, keep }
}
