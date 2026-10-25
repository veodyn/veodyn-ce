'use client'

import { Check, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { useApplyDashboardEdit } from '@/hooks/use-apply-dashboard-edit'
import { lastApplied } from '@/lib/chat/promotions'
import type { ActiveDashboard, DashboardEditDraftView, DraftView } from '@/lib/chat/thread-model'
import type { QueryDraftSync } from '@/lib/chat/thread-sync'
import type { ChatPromotion } from '@/lib/chat/wire'
import { ConflictPrompt } from './conflict-prompt'
import { UnsyncedNotice } from './unsynced-notice'

export const DASHBOARD_EDIT_CONFLICT_MESSAGE =
  'This dashboard or a widget changed after the chat read it. Overwrite those changes with this edit?'

interface DashboardEditActionsProps {
  draft: DashboardEditDraftView
  version: number
  queryDrafts: Record<string, DraftView>
  onQueryPromoted: (draftId: string, promotion: ChatPromotion) => void
  onApplied: (draftId: string, promotion: ChatPromotion) => void
  onDashboardActive: (dashboard: ActiveDashboard) => void
  querySync: QueryDraftSync
}

function forVersion(promotions: ChatPromotion[], version: number): ChatPromotion | undefined {
  return promotions.filter((one) => one.promotedVersion === version).at(-1)
}

function removalsConfirm(titles: string[]): string {
  const count = titles.length
  return `Remove ${count} ${count === 1 ? 'widget' : 'widgets'}? ${titles.join(', ')} will be deleted from the dashboard.`
}

export function DashboardEditActions({
  draft,
  version,
  queryDrafts,
  onQueryPromoted,
  onApplied,
  onDashboardActive,
  querySync,
}: DashboardEditActionsProps) {
  const application = useApplyDashboardEdit(
    draft,
    version,
    queryDrafts,
    onQueryPromoted,
    onApplied,
    onDashboardActive,
    querySync
  )
  const [confirming, setConfirming] = useState(false)
  const payload = draft.versions.find((one) => one.version === version)?.payload
  const latest = forVersion(draft.promotions, version)
  const link = lastApplied(draft.promotions)
  const removals = (payload?.operations ?? []).flatMap((one) => (one.op === 'remove' ? [one.title] : []))

  if (application.status === 'conflict') {
    return (
      <ConflictPrompt
        message={DASHBOARD_EDIT_CONFLICT_MESSAGE}
        overwriteLabel="Overwrite"
        keepLabel="Keep their changes"
        onOverwrite={() => application.apply(true, true)}
        onKeep={application.keep}
      />
    )
  }

  if (application.status === 'unsynced') return <UnsyncedNotice onRetry={application.retrySync} />

  const applying = application.status === 'applying'
  const finished = latest?.status === 'done'
  const total = payload?.operations.length ?? 0
  const landed = (latest?.receipts ?? []).filter((one) => one.step > 0 && one.outcome === 'done').length
  const openLink = link ? (
    <Link href={`/dashboards/${link.targetId}`} className={buttonVariants({ size: 'sm', variant: 'link' })} target="_blank" rel="noopener">
      {finished ? 'Applied. Open dashboard' : 'Open dashboard'}
    </Link>
  ) : null

  if (finished) return openLink

  return (
    <>
      {confirming ? (
        <div className="flex w-full flex-col gap-2 text-sm">
          <p className="text-pretty">{removalsConfirm(removals)}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={() => application.apply(false, true)} disabled={applying}>
              {applying ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Remove and apply
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={applying}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          onClick={() => (removals.length > 0 ? setConfirming(true) : application.apply(false, true))}
          disabled={applying}
        >
          {applying ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
          Apply
        </Button>
      )}
      {latest?.status === 'partial' ? (
        <p className="w-full text-pretty text-sm text-muted-foreground">
          {`${landed} of ${total} changes applied. Apply again to finish the rest.`}
        </p>
      ) : null}
      {openLink}
      {application.error ? (
        <p role="alert" className="w-full text-pretty text-sm text-destructive">
          {application.error}
        </p>
      ) : null}
    </>
  )
}
