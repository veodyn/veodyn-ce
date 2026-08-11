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
  /**
   * The Archive tab offers Restore; every other tab offers Archive. One row can
   * never offer both: an archived query has nothing left to archive, and a live
   * one has nothing to restore.
   */
  archived?: boolean
}

/**
 * The per-row overflow menu on `/queries`, and everything behind it: who may
 * act, which mutation runs, what the confirmation says and what the toast
 * reports.
 *
 * Kept out of `queries/page.tsx` because that file is already close to the
 * 300-line limit and this is the part that will keep growing.
 */
export function QueryRowActions({ query, archived = false }: QueryRowActionsProps) {
  const currentUser = useAuthStore((s) => s.currentUser)
  const archive = useArchiveQuery()
  const unarchive = useUnarchiveQuery()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)

  // Owner or admin, deliberately NOT can_edit, for two independent reasons.
  //
  // can_edit is absent from this payload. Redash attaches it in
  // QueryResource.get only (handlers/queries.py:402); the list endpoints
  // serialize through QuerySerializer, which does not emit it. So on a real
  // backend `query.can_edit` is undefined here and a non-admin author would see
  // no action on their own rows. Every mock query fixture hardcodes
  // `can_edit: true`, which is why that read green.
  //
  // And can_edit is the wrong rule anyway. It is can_modify, which is
  // `is_admin_or_owner(...) or user.has_access(obj, MODIFY)`, while the archive
  // it guards is `require_admin_or_owner(query.user_id)` (handlers/queries.py:431)
  // with no has_access arm. Someone granted MODIFY through the ACL has can_edit
  // and still gets a 403 on the archive.
  //
  // currentUser.canEdit is that guard already: admin, or the object's owner by
  // id (stores/auth-identity.ts:84).
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

  // Restore is not destructive and asks nothing: it puts a query back where it
  // was, and there is no cost to undo it again from the tab it came from.
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
