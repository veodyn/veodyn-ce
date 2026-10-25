'use client'

import { Check, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { useApplyVizChange } from '@/hooks/use-apply-viz-change'
import { lastApplied } from '@/lib/chat/promotions'
import type { VizDraftView } from '@/lib/chat/thread-model'
import type { ChatPromotion } from '@/lib/chat/wire'
import { ConflictPrompt } from './conflict-prompt'
import { UnsyncedNotice } from './unsynced-notice'

export const VIZ_CONFLICT_MESSAGE =
  'This visualization changed after the chat read it. Overwrite those changes with this one?'

interface VizDraftActionsProps {
  draft: VizDraftView
  version: number
  onApplied: (draftId: string, promotion: ChatPromotion) => void
}

export function VizDraftActions({ draft, version, onApplied }: VizDraftActionsProps) {
  const application = useApplyVizChange(draft, version, onApplied)
  const [confirming, setConfirming] = useState(false)
  const applied = lastApplied(draft.promotions)
  const payload = draft.versions.find((one) => one.version === version)?.payload

  if (application.status === 'conflict') {
    return (
      <ConflictPrompt
        message={VIZ_CONFLICT_MESSAGE}
        overwriteLabel="Overwrite"
        keepLabel="Keep their changes"
        onOverwrite={() => application.apply(true)}
        onKeep={application.keep}
      />
    )
  }

  if (application.status === 'unsynced') return <UnsyncedNotice onRetry={application.retrySync} />

  const applying = application.status === 'applying'
  const deleting = payload?.mode === 'delete'
  return (
    <>
      {applied !== undefined ? (
        <Link href={`/queries/${applied.targetId ?? payload?.queryId}`} className={buttonVariants({ size: 'sm', variant: 'link' })}>
          Applied. Open query {applied.targetId ?? payload?.queryId}
        </Link>
      ) : deleting && !confirming ? (
        <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
          Delete visualization
        </Button>
      ) : deleting ? (
        <div className="flex w-full flex-col gap-2 text-sm">
          <p className="text-pretty">{`Delete ${payload.snapshot.name}? Its dashboard widgets go with it.`}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={() => application.apply(false)} disabled={applying}>
              {applying ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Delete
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={applying}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" onClick={() => application.apply(false)} disabled={applying}>
          {applying ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
          Apply
        </Button>
      )}
      {application.error ? (
        <p role="alert" className="w-full text-pretty text-sm text-destructive">
          {application.error}
        </p>
      ) : null}
    </>
  )
}
