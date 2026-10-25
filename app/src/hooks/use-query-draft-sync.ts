'use client'

import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import type { ThreadState } from '@/lib/chat/thread-model'
import { holdQueryDraftSync, settleQueryDraftSync, type HeldQuerySync, type QueryDraftSync } from '@/lib/chat/thread-sync'
import type { ChatPromotion } from '@/lib/chat/wire'
import { patchPromotion } from '@/services/ai/chat-client'

export type QueryDraftSyncActions = Omit<QueryDraftSync, 'held'>

export function useQueryDraftSync(
  setState: Dispatch<SetStateAction<ThreadState>>,
  latest: () => ThreadState
): QueryDraftSyncActions {
  const inFlight = useRef(new Map<string, Promise<ChatPromotion | null>>())

  const hold = useCallback(
    (queryDraftId: string, held: HeldQuerySync) => setState((current) => holdQueryDraftSync(current, queryDraftId, held)),
    [setState]
  )

  const retry = useCallback(
    (queryDraftId: string) => {
      const running = inFlight.current.get(queryDraftId)
      if (running) return running
      const held = latest().queryDraftSync[queryDraftId]
      if (!held) return Promise.resolve(null)
      const attempt = patchPromotion(queryDraftId, held.promotion.id, held.patch)
        .then(
          (synced) => {
            const fresh = latest().queryDraftSync[queryDraftId] === held
            setState((current) => settleQueryDraftSync(current, queryDraftId, held, synced))
            return fresh ? synced : null
          },
          () => null
        )
        .finally(() => inFlight.current.delete(queryDraftId))
      inFlight.current.set(queryDraftId, attempt)
      return attempt
    },
    [latest, setState]
  )

  return { hold, retry }
}
