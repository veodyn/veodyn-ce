'use client'

import { Ban, CheckCircle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RedashUser } from './admin-user-list'

interface UserRowActionsProps {
  user: RedashUser
  onEnable: (user: RedashUser) => void
  onDisable: (user: RedashUser) => void
  onDelete: (user: RedashUser) => void
}

// Row-level action button for the admin user list: shows a different action
// depending on the user's status (disabled, pending invitation, or active).
export function UserRowActions({ user, onEnable, onDisable, onDelete }: UserRowActionsProps) {
  if (user.is_disabled) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation()
          onEnable(user)
        }}
      >
        <CheckCircle className="h-3.5 w-3.5 text-status-fresh" />
        Enable
      </Button>
    )
  }

  if (user.is_invitation_pending) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation()
          onDelete(user)
        }}
      >
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
        Delete
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={(e) => {
        e.stopPropagation()
        onDisable(user)
      }}
    >
      <Ban className="h-3.5 w-3.5 text-destructive" />
      Disable
    </Button>
  )
}
