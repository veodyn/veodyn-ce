'use client'

import { Check, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { Button, buttonVariants } from '@/components/ui/button'
import { useApplyQueryEdit } from '@/hooks/use-apply-query-edit'
import { lastApplied } from '@/lib/chat/promotions'
import type { EditDraftView } from '@/lib/chat/thread-model'
import type { ChatPromotion } from '@/lib/chat/wire'
import { ConflictPrompt } from './conflict-prompt'
import { UnsyncedNotice } from './unsynced-notice'

export const EDIT_CONFLICT_MESSAGE =
  'This query changed after the chat read it. Overwrite those changes with this edit?'

interface QueryEditActionsProps {
  draft: EditDraftView
  version: number
  onApplied: (draftId: string, promotion: ChatPromotion) => void
}

export function QueryEditActions({ draft, version, onApplied }: QueryEditActionsProps) {
  const application = useApplyQueryEdit(draft, version, onApplied)
  const applied = lastApplied(draft.promotions)
  const queryId = draft.versions.find((one) => one.version === version)?.payload.queryId

  if (application.status === 'conflict') {
    return (
      <ConflictPrompt
        message={EDIT_CONFLICT_MESSAGE}
        overwriteLabel="Overwrite"
        keepLabel="Keep their changes"
        onOverwrite={() => application.apply(true)}
        onKeep={application.keep}
      />
    )
  }

  if (application.status === 'unsynced') return <UnsyncedNotice onRetry={application.retrySync} />

  const applying = application.status === 'applying'
  return (
    <>
      {applied === undefined ? (
        <Button size="sm" onClick={() => application.apply(false)} disabled={applying}>
          {applying ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
          Apply
        </Button>
      ) : (
        <Link href={`/queries/${applied.targetId ?? queryId}`} className={buttonVariants({ size: 'sm', variant: 'link' })}>
          Applied. Open query {applied.targetId ?? queryId}
        </Link>
      )}
      {application.error ? (
        <p role="alert" className="w-full text-pretty text-sm text-destructive">
          {application.error}
        </p>
      ) : null}
    </>
  )
}
