'use client'

import { useState } from 'react'
import { Archive, ArchiveRestore } from 'lucide-react'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { RowActionsMenu, type RowAction } from '@/components/shared/row-actions-menu'
import { useToast } from '@/components/shared/toast-provider'
import { useArchiveDashboard, useUnarchiveDashboard } from '@/hooks/use-dashboards'
import type { MockDashboard } from '@/lib/mock-data'
import { removalCopy } from '@/lib/removal'
import { useAuthStore } from '@/stores/auth-store'

interface DashboardRowActionsProps {
  /**
   * Only what the actions need, so a list row and a detail page both fit.
   * `user` rather than `can_edit`: see the ownership note in the body.
   */
  dashboard: Pick<MockDashboard, 'id' | 'name' | 'user'>
  /** 'restore' on the Archive tab, 'archive' on every other listing. */
  intent?: 'archive' | 'restore'
  /**
   * Where to go once the dashboard is archived. Detail pages hand back a
   * navigation to the list, because the object they are showing has just left
   * every listing and a reload would 404. List rows pass nothing and stay put.
   */
  onArchived?: () => void
}

/**
 * Archive a dashboard, or put an archived one back.
 *
 * The one place that knows who may remove a dashboard, what the confirmation
 * says, and which mutation runs. The list rows and the detail page header both
 * render this, so the two cannot drift apart.
 */
export function DashboardRowActions({
  dashboard,
  intent = 'archive',
  onArchived,
}: DashboardRowActionsProps) {
  const currentUser = useAuthStore((s) => s.currentUser)
  const toast = useToast()
  const archive = useArchiveDashboard()
  const unarchive = useUnarchiveDashboard()
  const [confirming, setConfirming] = useState(false)

  // Owner or admin, not can_edit. Redash attaches can_edit in
  // DashboardResource.get only (handlers/dashboards.py:227); the list endpoints
  // serialize through DashboardSerializer and never emit it, so on a real
  // backend it is undefined on every row here and a non-admin author would be
  // offered nothing on their own dashboards. The mock fixtures all set
  // `can_edit: true`, which is why that read green.
  //
  // This is deliberately STRICTER than the server, which guards
  // DashboardResource.delete with `@require_permission("edit_dashboard")` and
  // no ownership test at all, so anyone holding that group permission can
  // archive anyone's dashboard. Offering that in the UI would let a colleague
  // archive your dashboard from a list, which is not what this feature is for.
  // Erring closed also keeps all five library types explainable by one
  // sentence: you can remove what you own, an admin can remove anything.
  const canRemove = currentUser?.canEdit(dashboard) === true

  // Hidden rather than disabled: a greyed-out item with no stated reason tells
  // a reader less than no item at all, and the server enforces the rule either
  // way. RowActionsMenu draws nothing for an empty list, so this returns before
  // building one.
  if (!canRemove) return null

  const copy = removalCopy('dashboard', dashboard.name)

  const runArchive = () => {
    archive.mutate(dashboard.id, {
      onSuccess: () => {
        setConfirming(false)
        toast.success(`${dashboard.name} is archived`)
        onArchived?.()
      },
      onError: () => {
        setConfirming(false)
        toast.error(`Could not archive ${dashboard.name}. You must own it, or be an admin.`)
      },
    })
  }

  // No confirmation on the way back in: restoring loses nothing, and the object
  // it acts on is already sitting on a tab called Archive.
  const runRestore = () => {
    unarchive.mutate(dashboard.id, {
      onSuccess: () => toast.success(`${dashboard.name} is back in your dashboards`),
      onError: () =>
        toast.error(`Could not restore ${dashboard.name}. You must own it, or be an admin.`),
    })
  }

  const actions: RowAction[] =
    intent === 'restore'
      ? [{ key: 'restore', label: 'Restore', icon: ArchiveRestore, onSelect: runRestore }]
      : [
          {
            key: 'archive',
            label: copy.verb,
            icon: Archive,
            onSelect: () => setConfirming(true),
            destructive: true,
          },
        ]

  return (
    <>
      {/* Names the object, so twenty rows do not offer twenty buttons all
          called "Actions". */}
      <RowActionsMenu label={`Actions for ${dashboard.name}`} actions={actions} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={copy.title}
        description={copy.description}
        confirmLabel={copy.verb}
        isPending={archive.isPending}
        onConfirm={runArchive}
      />
    </>
  )
}
