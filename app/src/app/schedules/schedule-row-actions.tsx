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
  canEdit: boolean
  onEdit: (query: MockQuery) => void
}

export function ScheduleRowActions({ query, canEdit, onEdit }: ScheduleRowActionsProps) {
  const [confirming, setConfirming] = useState(false)
  const updateQuery = useUpdateQuery()
  const toast = useToast()

  if (!canEdit) return null

  const remove = () => {
    updateQuery.mutate(
      { id: query.id, schedule: null },
      {
        onSuccess: () => {
          setConfirming(false)
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
