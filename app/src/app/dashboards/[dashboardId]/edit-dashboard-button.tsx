'use client'

import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { MockDashboard } from '@/lib/mock-data'

export function editRefusal(ownerName: string): string {
  const owner = ownerName.trim() || 'its owner'
  return `Only ${owner} can edit this dashboard.`
}

interface EditDashboardButtonProps {
  dashboard: MockDashboard
  onEdit: () => void
}

export function EditDashboardButton({ dashboard, onEdit }: EditDashboardButtonProps) {
  if (dashboard.can_edit) {
    return (
      <Button variant="outline" onClick={onEdit}>
        <Pencil className="h-4 w-4" />
        Edit
      </Button>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            disabled
            focusableWhenDisabled
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          />
        }
      >
        <Pencil className="h-4 w-4" />
        Edit
      </TooltipTrigger>
      <TooltipContent>{editRefusal(dashboard.user?.name ?? '')}</TooltipContent>
    </Tooltip>
  )
}
