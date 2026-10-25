'use client'

import { useCallback, useState } from 'react'
import type { ChatPromotion } from '@/lib/chat/wire'
import { patchPromotion, type PromotionPatch } from '@/services/ai/chat-client'

interface HeldRecord {
  promotion: ChatPromotion
  patch: PromotionPatch
}

export interface UnsyncedRecord {
  held: boolean
  hold: (promotion: ChatPromotion, patch: PromotionPatch) => void
  retry: () => void
}

export function useUnsyncedRecord(draftId: string, onSynced: (promotion: ChatPromotion) => void): UnsyncedRecord {
  const [record, setRecord] = useState<HeldRecord | null>(null)

  const hold = useCallback((promotion: ChatPromotion, patch: PromotionPatch) => {
    setRecord({ promotion, patch })
  }, [])

  const retry = useCallback(() => {
    if (!record) return
    void patchPromotion(draftId, record.promotion.id, record.patch).then(
      (promotion) => {
        setRecord(null)
        onSynced(promotion)
      },
      () => undefined
    )
  }, [record, draftId, onSynced])

  return { held: record !== null, hold, retry }
}
