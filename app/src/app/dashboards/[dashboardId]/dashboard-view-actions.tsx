'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Pencil, Presentation, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/shared/icon-button'
import { hasFeature } from '@/features'
import { Slot } from '@/features/slots'
import type { MockDashboard } from '@/lib/mock-data'
import { DashboardRowActions } from '../dashboard-row-actions'

interface DashboardViewActionsProps {
  dashboard: MockDashboard
  onEdit: () => void
  onShare: () => void
}

/**
 * The header action cluster a dashboard shows when it is not being edited. The
 * edit-session cluster stays in the page, driven by that page's own state.
 *
 * Two actions are not community. "Promote to report" belongs to the reports
 * feature and arrives through the dashboard.viewActions slot, after Present and
 * before Edit. Present is community markup pointing at /present, a route the
 * wall package owns, so it is gated on that package rather than contributed.
 */
export function DashboardViewActions({ dashboard, onEdit, onShare }: DashboardViewActionsProps) {
  const router = useRouter()

  return (
    <>
      {hasFeature('wall') && (
        <Button variant="outline" render={<Link href={`/present/${dashboard.id}`} />}>
          <Presentation className="h-4 w-4" />
          Present
        </Button>
      )}
      <Slot id="dashboard.viewActions" props={{ dashboard }} fallback={null} />
      <Button variant="outline" onClick={onEdit}>
        <Pencil className="h-4 w-4" />
        Edit
      </Button>
      <IconButton tooltip="Share dashboard" variant="outline" size="icon" onClick={onShare}>
        <Share2 className="h-4 w-4" />
      </IconButton>
      {/* Archiving from a detail page has to leave it: the dashboard drops out
          of every listing, so staying put strands the reader on a page that no
          longer resolves. */}
      <DashboardRowActions
        dashboard={dashboard}
        onArchived={() => router.push('/dashboards')}
      />
    </>
  )
}
