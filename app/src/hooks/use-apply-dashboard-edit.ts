'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useWriteProposedQuery } from '@/components/chat/proposal-kit/use-write-proposed-query'
import { applyDashboardEdit, type DashboardEditDraft } from '@/lib/chat/dashboard-edit-apply'
import type { ActiveDashboard, DraftView } from '@/lib/chat/thread-model'
import { browserTransport } from '@/lib/chat/transport'
import type { ChatPromotion } from '@/lib/chat/wire'
import { patchPromotion, type PromotionPatch } from '@/services/ai/chat-client'
import { resolveDraftChart, type QueryDraftHold, type QueryPromoted } from './resolve-draft-chart'
import type { ApplyStatus } from './use-apply-query-edit'

export interface DashboardEditApplication {
  status: ApplyStatus
  error: string | null
  apply: (overwrite: boolean, confirmRemovals: boolean) => void
  retrySync: () => void
  keep: () => void
}

interface UnsyncedSave {
  promotion: ChatPromotion
  patch: PromotionPatch
}

export function useApplyDashboardEdit(
  draft: DashboardEditDraft,
  version: number,
  queryDrafts: Record<string, DraftView>,
  onQueryPromoted: QueryPromoted,
  onApplied: (draftId: string, promotion: ChatPromotion) => void,
  onDashboardActive: (dashboard: ActiveDashboard) => void,
  querySync: QueryDraftHold
): DashboardEditApplication {
  const queryClient = useQueryClient()
  const { write } = useWriteProposedQuery()
  const [status, setStatus] = useState<ApplyStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [unsynced, setUnsynced] = useState<UnsyncedSave | null>(null)
  const dashboardId = draft.versions.find((one) => one.version === version)?.payload.dashboardId

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['dashboards'] })
    if (dashboardId !== undefined) void queryClient.invalidateQueries({ queryKey: ['dashboard', dashboardId] })
  }, [queryClient, dashboardId])

  const promoteDraft = useCallback(
    async (queryDraftId: string) => {
      const resolved = await resolveDraftChart(write, queryDrafts[queryDraftId], onQueryPromoted, querySync)
      return resolved && 'visualizationId' in resolved
        ? { queryId: resolved.queryId, visualizationId: resolved.visualizationId }
        : null
    },
    [write, queryDrafts, onQueryPromoted, querySync]
  )

  const apply = useCallback(
    (overwrite: boolean, confirmRemovals: boolean) => {
      setStatus('applying')
      setError(null)
      void applyDashboardEdit(draft, version, browserTransport, { overwrite, confirmRemovals, promoteDraft }).then(
        (outcome) => {
          if (outcome.status === 'done' || outcome.status === 'unsynced') {
            if (outcome.dashboard) onDashboardActive(outcome.dashboard)
            refresh()
          }
          if (outcome.status === 'done') {
            onApplied(draft.id, outcome.promotion)
            setStatus('idle')
          } else if (outcome.status === 'unsynced') {
            setUnsynced({ promotion: outcome.promotion, patch: outcome.patch })
            setStatus('unsynced')
          } else if (outcome.status === 'conflict') {
            if (outcome.promotion) onApplied(draft.id, outcome.promotion)
            refresh()
            setStatus('conflict')
          } else {
            if (outcome.promotion) onApplied(draft.id, outcome.promotion)
            setError(outcome.error)
            refresh()
            setStatus('idle')
          }
        }
      )
    },
    [draft, version, promoteDraft, onApplied, onDashboardActive, refresh]
  )

  const retrySync = useCallback(() => {
    if (!unsynced) return
    void patchPromotion(draft.id, unsynced.promotion.id, unsynced.patch).then(
      (promotion) => {
        onApplied(draft.id, promotion)
        setUnsynced(null)
        setStatus('idle')
      },
      () => setStatus('unsynced')
    )
  }, [unsynced, draft.id, onApplied])

  const keep = useCallback(() => setStatus('idle'), [])

  return { status, error, apply, retrySync, keep }
}
