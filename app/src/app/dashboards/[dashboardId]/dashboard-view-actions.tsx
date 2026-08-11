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
 * The header action cluster a dashboard shows when it is not being edited.
 *
 * Split out of the page, which was already over the file size limit before it
 * gained an Archive action. The edit-session cluster stays in the page: it is
 * driven entirely by that page's own state and threading four setters out here
 * would buy nothing.
 *
 * Every action here is community except two, and they are absent for two
 * different reasons. "Promote to report" writes a report, so it is the reports
 * feature's, and it arrives through the dashboard.viewActions slot in the
 * place it has always sat: after Present, before Edit. Present is community
 * markup pointing at an enterprise ROUTE, /present, which the wall package
 * owns, so there is nothing for a feature to contribute and the only question
 * is whether the destination exists. A build without either shows the row two
 * buttons shorter and nothing else changes.
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
      {/* Where the dead "Dashboard options" kebab used to sit. Archiving from a
          detail page has to leave it: the dashboard drops out of every listing,
          so staying put would leave the reader on a page that no longer
          resolves. */}
      <DashboardRowActions
        dashboard={dashboard}
        onArchived={() => router.push('/dashboards')}
      />
    </>
  )
}
