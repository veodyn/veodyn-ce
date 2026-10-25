'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import type { ApplyOutcome } from '@/lib/chat/query-edit-apply'
import type { ChatPromotion } from '@/lib/chat/wire'
import { patchPromotion, type PromotionPatch } from '@/services/ai/chat-client'

export type SnippetApplyStatus = 'idle' | 'applying' | 'conflict' | 'unsynced'

export interface SnippetApplication {
  status: SnippetApplyStatus
  error: string | null
  apply: (overwrite: boolean) => void
  retrySync: () => void
  keep: () => void
}

interface UnsyncedSave {
  promotion: ChatPromotion
  patch: PromotionPatch
}

export function useApplySnippetDraft(
  draftId: string,
  run: (overwrite: boolean) => Promise<ApplyOutcome>,
  onApplied: (promotion: ChatPromotion) => void
): SnippetApplication {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<SnippetApplyStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [unsynced, setUnsynced] = useState<UnsyncedSave | null>(null)

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['query-snippets'] })
  }, [queryClient])

  const apply = useCallback(
    (overwrite: boolean) => {
      setStatus('applying')
      setError(null)
      void run(overwrite).then((outcome) => {
        if (outcome.status === 'done') {
          onApplied(outcome.promotion)
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
    [run, onApplied, refresh]
  )

  const retrySync = useCallback(() => {
    if (!unsynced) return
    void patchPromotion(draftId, unsynced.promotion.id, unsynced.patch).then(
      (promotion) => {
        onApplied(promotion)
        setUnsynced(null)
        setStatus('idle')
      },
      () => setStatus('unsynced')
    )
  }, [unsynced, draftId, onApplied])

  const keep = useCallback(() => setStatus('idle'), [])

  return { status, error, apply, retrySync, keep }
}
