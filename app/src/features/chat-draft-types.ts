import type { ComponentType } from 'react'
import type { DraftView } from '@/lib/chat/thread-model'
import type { HeldQuerySync, QueryDraftSyncs } from '@/lib/chat/thread-sync'
import type { ChatPromotion } from '@/lib/chat/wire'

export interface ChatDraftCardProps {
  threadId: string
  draftId: string
  version: number
  payload: unknown
  promotions: ChatPromotion[]
  queryDrafts: Readonly<Record<string, DraftView>>
  queryDraftSync: QueryDraftSyncs
  onPromoted(promotion: ChatPromotion): void
  onQueryDraftPromoted(queryDraftId: string, promotion: ChatPromotion): void
  holdQueryDraftSync(queryDraftId: string, held: HeldQuerySync): void
  retryQueryDraftSync(queryDraftId: string): Promise<ChatPromotion | null>
}

export interface ChatDraftContribution {
  kind: string
  parse(payload: unknown): unknown | null
  card: () => Promise<{ default: ComponentType<ChatDraftCardProps> }>
}
