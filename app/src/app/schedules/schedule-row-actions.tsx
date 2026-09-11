'use client'

import { useState } from 'react'
import { CalendarOff, Pencil } from 'lucide-react'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { IconButton } from '@/components/shared/icon-button'
import { useToast } from '@/components/shared/toast-provider'
import { useUpdateQuery } from '@/hooks/use-queries'
import type { MockQuery } from '@/lib/mock-data'

interface ScheduleRowActionsProps {
  query: MockQuery
  /** Decided by the page, so the cadence cell and these buttons agree. */
  canEdit: boolean
  onEdit: (query: MockQuery) => void
}

/**
 * Edit and Remove, per row, as two visible buttons.
 *
 * The library lists put their row actions behind the `RowActionsMenu` kebab,
 * and this page deliberately does not: there, acting on a row is incidental to
 * browsing it, while here changing and clearing schedules is the entire reason
 * the page exists. A kebab would hide both of the page's verbs behind a click
 * whose label is "Actions".
 *
 * Removing a schedule is not deleting the query, and the two must never be
 * confused, so the icon is a struck-through calendar rather than a bin and the
 * confirmation says in words what survives.
 */
export function ScheduleRowActions({ query, canEdit, onEdit }: ScheduleRowActionsProps) {
  const [confirming, setConfirming] = useState(false)
  const updateQuery = useUpdateQuery()
  const toast = useToast()

  // Nothing at all rather than disabled buttons: a control that explains
  // nothing about why it is dead is worse than the space it occupies.
  if (!canEdit) return null

  const remove = () => {
    updateQuery.mutate(
      { id: query.id, schedule: null },
      {
        onSuccess: () => {
          setConfirming(false)
          // The row leaves the page on success, which on its own reads as the
          // click having gone wrong.
          toast.success(`${query.name} no longer refreshes on a schedule`)
        },
        onError: () => {
          setConfirming(false)
          toast.error(`Could not remove the schedule from ${query.name}`)
        },
      }
    )
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {/* The tooltip is the verb; the aria-label names the row, because twenty
          buttons called "Edit schedule" name nothing to a screen reader. */}
      <IconButton
        tooltip="Edit schedule"
        aria-label={`Edit the refresh schedule for ${query.name}`}
        variant="ghost"
        size="icon-xs"
        onClick={() => onEdit(query)}
      >
        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
      </IconButton>
      <IconButton
        tooltip="Remove schedule"
        aria-label={`Remove the refresh schedule from ${query.name}`}
        variant="ghost"
        size="icon-xs"
        onClick={() => setConfirming(true)}
      >
        <CalendarOff className="h-3.5 w-3.5 text-muted-foreground" />
      </IconButton>
      {confirming && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(false)
          }}
          title="Remove this refresh schedule?"
          description={`"${query.name}" will stop refreshing on its own. The query, its results and everything built on it stay exactly as they are, and you can set a new schedule whenever you like.`}
          confirmLabel="Remove schedule"
          isPending={updateQuery.isPending}
          onConfirm={remove}
        />
      )}
    </div>
  )
}
