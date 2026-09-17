'use client'

import type { DraftView } from '@/lib/chat/thread-model'
import type { ChatPromotion } from '@/lib/chat/wire'

interface DraftActionsProps {
  draft: DraftView
  dataSourceId: number | null
  onPromoted: (draftId: string, promotion: ChatPromotion) => void
}

export function DraftActions({ draft }: DraftActionsProps) {
  const promotion = draft.promotions[draft.promotions.length - 1]
  if (!promotion) return null
  return <p className="text-xs text-muted-foreground">Saved as query {promotion.targetId}</p>
}
