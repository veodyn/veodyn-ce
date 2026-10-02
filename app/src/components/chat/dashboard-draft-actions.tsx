'use client'

import Link from 'next/link'
import { Loader2, Save } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { usePromoteDashboardDraft } from '@/hooks/use-promote-dashboard-draft'
import type { ActiveDashboard, DashboardDraftView, DraftView } from '@/lib/chat/thread-model'
import type { ChatPromotion } from '@/lib/chat/wire'

export const DASHBOARD_CONFLICT_MESSAGE = 'This dashboard has changed since you opened it. Add these charts anyway?'

interface DashboardDraftActionsProps {
  draft: DashboardDraftView
  queryDrafts: Record<string, DraftView>
  activeDashboard: ActiveDashboard | null
  onQueryPromoted: (draftId: string, promotion: ChatPromotion) => void
  onDashboardPromoted: (draftId: string, promotion: ChatPromotion) => void
  onDashboardActive: (dashboard: ActiveDashboard) => void
}

export function DashboardDraftActions({
  draft,
  queryDrafts,
  activeDashboard,
  onQueryPromoted,
  onDashboardPromoted,
  onDashboardActive,
}: DashboardDraftActionsProps) {
  const promote = usePromoteDashboardDraft(
    draft,
    queryDrafts,
    activeDashboard,
    onQueryPromoted,
    onDashboardPromoted,
    onDashboardActive
  )
  const latest = draft.versions[draft.versions.length - 1]
  const promotion = draft.promotions[draft.promotions.length - 1]
  const saving = promote.status === 'saving'

  if (promote.status === 'conflict') {
    return (
      <div role="alert" className="flex w-full flex-col gap-2 text-sm">
        <p className="text-pretty">{DASHBOARD_CONFLICT_MESSAGE}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="destructive" onClick={() => promote.append(true)}>
            Add anyway
          </Button>
          <Button size="sm" variant="outline" onClick={promote.keep}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <>
      <Button size="sm" onClick={promote.save} disabled={saving || !latest}>
        {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
        Save as new dashboard
      </Button>
      {activeDashboard ? (
        <Button size="sm" variant="outline" onClick={() => promote.append(false)} disabled={saving || !latest}>
          {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
          {`Add to ${activeDashboard.name}`}
        </Button>
      ) : null}
      {promotion ? (
        <Link
          href={`/dashboards/${promotion.targetId}`}
          className={buttonVariants({ size: 'sm', variant: 'link' })}
          target="_blank"
          rel="noopener"
        >
          Open dashboard
        </Link>
      ) : null}
      {promote.skipped.length > 0 ? (
        <p className="w-full text-pretty text-xs text-muted-foreground">
          {`Skipped: ${promote.skipped.join(', ')}.`}
        </p>
      ) : null}
      {promote.error ? (
        <p role="alert" className="w-full text-pretty text-sm text-destructive">
          {promote.error}
        </p>
      ) : null}
    </>
  )
}
