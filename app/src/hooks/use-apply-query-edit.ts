'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { applyQueryEdit, type EditDraft } from '@/lib/chat/query-edit'
import { browserTransport } from '@/lib/chat/transport'
import type { ChatPromotion } from '@/lib/chat/wire'
import { patchPromotion, type PromotionPatch } from '@/services/ai/chat-client'

export type ApplyStatus = 'idle' | 'applying' | 'conflict' | 'unsynced'

export interface QueryEditApplication {
  status: ApplyStatus
  error: string | null
  apply: (overwrite: boolean) => void
  retrySync: () => void
  keep: () => void
}

interface UnsyncedSave {
  promotion: ChatPromotion
  patch: PromotionPatch
}

export function useApplyQueryEdit(
  draft: EditDraft,
  version: number,
  onApplied: (draftId: string, promotion: ChatPromotion) => void
): QueryEditApplication {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<ApplyStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [unsynced, setUnsynced] = useState<UnsyncedSave | null>(null)
  const queryId = draft.versions.find((one) => one.version === version)?.payload.queryId
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['queries'] })
    if (queryId !== undefined) void queryClient.invalidateQueries({ queryKey: ['query', queryId] })
  }, [queryClient, queryId])

  const apply = useCallback(
    (overwrite: boolean) => {
      setStatus('applying')
      setError(null)
      void applyQueryEdit(draft, version, browserTransport, { overwrite }).then((outcome) => {
        if (outcome.status === 'done') {
          onApplied(draft.id, outcome.promotion)
          refresh()
          setStatus('idle')
        } else if (outcome.status === 'unsynced') {
          setUnsynced({ promotion: outcome.promotion, patch: outcome.patch })
          refresh()
          setStatus('unsynced')
        } else if (outcome.status === 'conflict') {
          setStatus('conflict')
        } else {
          setError(outcome.error)
          setStatus('idle')
        }
      })
    },
    [draft, version, onApplied, refresh]
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
