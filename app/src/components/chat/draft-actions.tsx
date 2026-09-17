'use client'

import Link from 'next/link'
import { Loader2, Save } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { usePromoteDraft } from '@/hooks/use-promote-draft'
import type { DraftView } from '@/lib/chat/thread-model'
import type { ChatPromotion } from '@/lib/chat/wire'

export const CONFLICT_MESSAGE = 'This query was changed in Veodyn after it was saved from the chat. Overwrite those changes?'

interface DraftActionsProps {
  draft: DraftView
  dataSourceId: number | null
  onPromoted: (draftId: string, promotion: ChatPromotion) => void
}

export function DraftActions({ draft, dataSourceId, onPromoted }: DraftActionsProps) {
  const promote = usePromoteDraft(draft, dataSourceId, onPromoted)
  const latest = draft.versions[draft.versions.length - 1]
  const promotion = draft.promotions[draft.promotions.length - 1]
  const saving = promote.status === 'saving'
  const behind = promotion !== undefined && latest !== undefined && promotion.promotedVersion < latest.version

  if (promote.status === 'conflict') {
    return (
      <div role="alert" className="flex w-full flex-col gap-2 text-sm">
        <p className="text-pretty">{CONFLICT_MESSAGE}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="destructive" onClick={() => promote.update(true)}>
            Overwrite
          </Button>
          <Button size="sm" variant="outline" onClick={promote.keep}>
            Keep their changes
          </Button>
        </div>
      </div>
    )
  }

  return (
    <>
      {promotion === undefined ? (
        <Button size="sm" onClick={promote.save} disabled={saving || dataSourceId === null}>
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
      {promotion !== undefined ? (
        <Link href={`/queries/${promotion.targetId}`} className={buttonVariants({ size: 'sm', variant: 'link' })}>
          {behind ? 'Open saved query' : `Saved as query ${promotion.targetId} · v${promotion.promotedVersion}`}
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
