'use client'

import { useCallback, useState } from 'react'
import { useWriteProposedQuery } from '@/components/ai/create-chat/proposals/use-write-proposed-query'
import { useUpdateQuery } from '@/hooks/use-queries'
import { useCreateVisualization, useUpdateVisualization } from '@/hooks/use-visualizations'
import type { DraftView } from '@/lib/chat/thread-model'
import type { ChatPromotion } from '@/lib/chat/wire'
import { readQueryError } from '@/lib/query-error'
import { DEFAULT_VIZ_ID, resolveVizChoice } from '@/lib/viz-choices'
import * as queriesService from '@/services/redash/queries'
import { promoteQueryDraft, recordQueryPromotion } from './promote-query-draft'

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

export function usePromoteDraft(draft: DraftView, onPromoted: Promoted): DraftPromotion {
  const { write } = useWriteProposedQuery()
  const updateQuery = useUpdateQuery()
  const createVisualization = useCreateVisualization()
  const updateVisualization = useUpdateVisualization()
  const [status, setStatus] = useState<PromoteStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const latest = draft.versions[draft.versions.length - 1]
  const promotion = draft.promotions[draft.promotions.length - 1]

  const fail = useCallback((cause: unknown) => {
    setError(readQueryError(cause).message)
    setStatus('idle')
  }, [])

  const save = useCallback(() => {
    if (!latest) return
    setStatus('saving')
    setError(null)
    promoteQueryDraft(write, draft)
      .then((written) => {
        onPromoted(draft.id, written.promotion)
        setStatus('idle')
      })
      .catch(fail)
  }, [latest, write, draft, onPromoted, fail])

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
        const saved = await recordQueryPromotion(draft, queryId, updated.version)
        onPromoted(draft.id, saved)
        setStatus('idle')
      }
      run().catch(fail)
    },
    [latest, promotion, draft, updateQuery, updateVisualization, createVisualization, onPromoted, fail]
  )

  const keep = useCallback(() => setStatus('idle'), [])

  return { status, error, save, update, keep }
}
