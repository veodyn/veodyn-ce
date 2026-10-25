'use client'

import { createElement, Suspense } from 'react'
import { chatDraftCardFor } from '@/features/chat-drafts'
import type { ContributedDraftView, DraftView } from '@/lib/chat/thread-model'
import type { QueryDraftSync } from '@/lib/chat/thread-sync'
import type { ChatPromotion } from '@/lib/chat/wire'

interface ContributedDraftProps {
  threadId: string
  draft: ContributedDraftView
  version: number
  queryDrafts: Readonly<Record<string, DraftView>>
  onPromoted: (draftId: string, promotion: ChatPromotion) => void
  onQueryDraftPromoted: (queryDraftId: string, promotion: ChatPromotion) => void
  querySync: QueryDraftSync
}

export function cannotShowMessage(kind: string): string {
  return `This build cannot show a ${kind} proposal.`
}

export function ContributedDraft({
  threadId,
  draft,
  version,
  queryDrafts,
  onPromoted,
  onQueryDraftPromoted,
  querySync,
}: ContributedDraftProps) {
  const shown = draft.versions.find((one) => one.version === version) ?? draft.versions[draft.versions.length - 1]
  const card = chatDraftCardFor(draft.kind)
  if (!card || !shown) {
    return <p className="text-sm text-muted-foreground">{cannotShowMessage(draft.kind)}</p>
  }
  return (
    <Suspense fallback={null}>
      {createElement(card, {
        threadId,
        draftId: draft.id,
        version: shown.version,
        payload: shown.payload,
        promotions: draft.promotions,
        queryDrafts,
        onPromoted: (promotion: ChatPromotion) => onPromoted(draft.id, promotion),
        onQueryDraftPromoted,
        queryDraftSync: querySync.held,
        holdQueryDraftSync: querySync.hold,
        retryQueryDraftSync: querySync.retry,
      })}
    </Suspense>
  )
}
