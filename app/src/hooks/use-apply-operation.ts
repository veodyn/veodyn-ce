'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { useOptionalConfig } from '@/components/config/config-provider'
import {
  applyOperation,
  finishFork,
  type OperationDraft,
  type OperationOutcome,
  type OperationResult,
} from '@/lib/chat/operation-apply'
import { browserTransport } from '@/lib/chat/transport'
import { readQueryError } from '@/lib/query-error'
import type { ChatPromotion } from '@/lib/chat/wire'
import { patchPromotion, type PromotionPatch } from '@/services/ai/chat-client'
import type { ApplyStatus } from './use-apply-query-edit'

export interface OperationApplication {
  status: ApplyStatus
  error: string | null
  result: OperationResult | null
  apply: (choice: { confirmed: boolean; overwrite: boolean }) => void
  finish: (promotion: ChatPromotion) => void
  retrySync: () => void
  keep: () => void
}

interface UnsyncedSave {
  promotion: ChatPromotion
  patch: PromotionPatch
}

export function useApplyOperation(
  draft: OperationDraft,
  version: number,
  onApplied: (draftId: string, promotion: ChatPromotion) => void
): OperationApplication {
  const queryClient = useQueryClient()
  const queryDrafts = useOptionalConfig()?.features.query_drafts ?? false
  const [status, setStatus] = useState<ApplyStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<OperationResult | null>(null)
  const [unsynced, setUnsynced] = useState<UnsyncedSave | null>(null)
  const running = useRef(false)

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['queries'] })
    void queryClient.invalidateQueries({ queryKey: ['query'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboards'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }, [queryClient])

  const run = useCallback(
    (work: () => Promise<OperationOutcome>) => {
      if (running.current) return
      running.current = true
      setStatus('applying')
      setError(null)
      void work()
        .then((outcome) => {
          if (outcome.status === 'done') {
            setResult(outcome.result)
            onApplied(draft.id, outcome.promotion)
            refresh()
            setStatus('idle')
          } else if (outcome.status === 'unsynced') {
            setResult(outcome.result)
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
        .catch((cause: unknown) => {
          setError(readQueryError(cause).message)
          setStatus('idle')
        })
        .finally(() => {
          running.current = false
        })
    },
    [draft.id, onApplied, refresh]
  )

  const apply = useCallback(
    ({ confirmed, overwrite }: { confirmed: boolean; overwrite: boolean }) =>
      run(() => applyOperation(draft, version, browserTransport, { confirmed, overwrite, queryDrafts })),
    [run, draft, version, queryDrafts]
  )

  const finish = useCallback(
    (promotion: ChatPromotion) => run(() => finishFork(draft, promotion, browserTransport)),
    [run, draft]
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

  return { status, error, result, apply, finish, retrySync, keep }
}
