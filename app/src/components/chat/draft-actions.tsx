'use client'

import Link from 'next/link'
import { Loader2, Save } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { usePromoteDraft } from '@/hooks/use-promote-draft'
import { lastApplied } from '@/lib/chat/promotions'
import type { DraftView } from '@/lib/chat/thread-model'
import type { QueryDraftSync } from '@/lib/chat/thread-sync'
import type { ChatPromotion } from '@/lib/chat/wire'
import { ConflictPrompt } from './conflict-prompt'
import { UnsyncedNotice } from './unsynced-notice'

export const CONFLICT_MESSAGE = 'This query was changed in Veodyn after it was saved from the chat. Overwrite those changes?'

interface DraftActionsProps {
  draft: DraftView
  onPromoted: (draftId: string, promotion: ChatPromotion) => void
  querySync: QueryDraftSync
}

export function DraftActions({ draft, onPromoted, querySync }: DraftActionsProps) {
  const promote = usePromoteDraft(draft, onPromoted, querySync)
  const latest = draft.versions[draft.versions.length - 1]
  const promotion = lastApplied(draft.promotions)
  const saving = promote.status === 'saving'
  const chartPending =
    promotion !== undefined && promotion.status === 'partial' && promotion.promotedVersion === latest?.version
  const behind = promotion !== undefined && latest !== undefined && promotion.promotedVersion < latest.version

  if (promote.unsynced) return <UnsyncedNotice onRetry={promote.retrySync} />

  if (promote.status === 'conflict') {
    return (
      <ConflictPrompt
        message={CONFLICT_MESSAGE}
        overwriteLabel="Overwrite"
        keepLabel="Keep their changes"
        onOverwrite={() => promote.update(true)}
        onKeep={promote.keep}
      />
    )
  }

  return (
    <>
      {promotion === undefined ? (
        <Button size="sm" onClick={promote.save} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
          Save as query
        </Button>
      ) : null}
      {behind ? (
        <Button size="sm" onClick={() => promote.update(false)} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
          Update saved query
        </Button>
      ) : null}
      {chartPending ? (
        <Button size="sm" onClick={promote.retryChart} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
          Retry chart update
        </Button>
      ) : null}
      {promotion !== undefined ? (
        <Link href={`/queries/${promotion.targetId}`} className={buttonVariants({ size: 'sm', variant: 'link' })}>
          {behind || chartPending ? 'Open saved query' : `Saved as query ${promotion.targetId} · v${promotion.promotedVersion}`}
        </Link>
      ) : null}
      {promote.error ? (
        <p role="alert" className="w-full text-pretty text-sm text-destructive">
          {promote.error}
        </p>
      ) : null}
    </>
  )
}
