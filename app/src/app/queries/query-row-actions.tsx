'use client'

import { useState } from 'react'
import { Archive, ArchiveRestore } from 'lucide-react'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { RowActionsMenu, type RowAction } from '@/components/shared/row-actions-menu'
import { useToast } from '@/components/shared/toast-provider'
import { useArchiveQuery, useUnarchiveQuery } from '@/hooks/use-queries'
import { removalCopy } from '@/lib/removal'
import { useAuthStore } from '@/stores/auth-store'
import type { MockQuery } from '@/lib/mock-data'

interface QueryRowActionsProps {
  query: MockQuery
  /** The Archive tab offers Restore; every other tab offers Archive, never both. */
  archived?: boolean
}

/**
 * The per-row overflow menu on `/queries`: who may act, which mutation runs,
 * what the confirmation says and what the toast reports.
 */
export function QueryRowActions({ query, archived = false }: QueryRowActionsProps) {
  const currentUser = useAuthStore((s) => s.currentUser)
  const archive = useArchiveQuery()
  const unarchive = useUnarchiveQuery()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)

  // Owner or admin, NOT can_edit, for two reasons. can_edit is absent from list
  // payloads: Redash attaches it in QueryResource.get only
  // (handlers/queries.py:402). And it is the wrong rule, since it includes an
  // ACL MODIFY arm the archive endpoint does not
  // (`require_admin_or_owner(query.user_id)`, handlers/queries.py:431).
  // currentUser.canEdit is that guard (stores/auth-identity.ts:84).
  const canModify = currentUser?.canEdit(query) === true
  const copy = removalCopy('query', query.name)

  const restore = () => {
    unarchive.mutate(query.id, {
      onSuccess: () => toast.success(`${query.name} is back in your queries`),
      onError: () =>
        toast.error(`Could not restore ${query.name}. You must own it, or be an admin.`),
    })
  }

  const confirmArchive = () => {
    archive.mutate(query.id, {
      onSuccess: () => {
        setConfirming(false)
        toast.success(`Archived "${query.name}".`)
      },
      onError: () => {
        setConfirming(false)
        toast.error(`Could not archive "${query.name}". You must own it, or be an admin.`)
      },
    })
  }

  // Restore asks for no confirmation: it is undoable from the tab it came from.
  const actions: RowAction[] = !canModify
    ? []
    : archived
      ? [{ key: 'restore', label: 'Restore', icon: ArchiveRestore, onSelect: restore }]
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
      <RowActionsMenu label={`Actions for ${query.name}`} actions={actions} />
      {confirming && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(false)
          }}
          title={copy.title}
          description={copy.description}
          confirmLabel={copy.verb}
          isPending={archive.isPending}
          onConfirm={confirmArchive}
        />
      )}
    </>
  )
}
