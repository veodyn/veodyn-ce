'use client'

import type { KeyboardEvent, MouseEvent } from 'react'
import { MoreHorizontal, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface RowAction {
  key: string
  /** The verb, as a person would say it: "Archive", "Restore", "Delete". */
  label: string
  icon: LucideIcon
  onSelect: () => void
  /** Red, and grouped last. For anything that loses data. */
  destructive?: boolean
}

interface RowActionsMenuProps {
  /**
   * Names the object, not the control: "Actions for Weekly revenue". A table of
   * twenty rows otherwise offers twenty buttons all called "Actions".
   */
  label: string
  actions: RowAction[]
  align?: 'start' | 'end'
}

/**
 * The per-item overflow menu, on list rows and on detail page headers.
 *
 * Renders **nothing** when `actions` is empty. Permission is expressed by
 * handing this component a shorter list, so a viewer who owns nothing sees no
 * control at all rather than a kebab holding one greyed-out item with no
 * explanation of why.
 *
 * Kept out of `ItemsTable` on purpose: the table's `Column` contract stays
 * "render me a cell", and a page that wants actions renders this into one. The
 * alternative, an `onDelete` prop on the table, needs a new prop and a new
 * column for every action anyone adds later.
 */
export function RowActionsMenu({ label, actions, align = 'end' }: RowActionsMenuProps) {
  if (actions.length === 0) return null

  const ordered = [...actions].sort(
    (a, b) => Number(a.destructive ?? false) - Number(b.destructive ?? false)
  )

  // Library list rows are clickable and keyboard-operable (ItemsTable puts
  // tabIndex, onClick and an Enter/Space onKeyDown on the <tr>). Without this,
  // opening the menu also navigates to the item, and Space on the trigger both
  // opens the menu and follows the row.
  const swallow = (event: MouseEvent | KeyboardEvent) => event.stopPropagation()

  return (
    <DropdownMenu>
      {/* The tooltip wraps the trigger rather than replacing it: the kebab has
          to stay the element that opens the menu, so the trigger renders
          through it. Same composition as visualization-tabs.tsx. */}
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              aria-label={label}
              onClick={swallow}
              onKeyDown={swallow}
              render={<Button variant="ghost" size="icon-xs" />}
            />
          }
        >
          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>Actions</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align={align} className="min-w-[160px]" onClick={swallow}>
        {ordered.map((action) => {
          const Icon = action.icon
          return (
            <DropdownMenuItem
              key={action.key}
              onClick={action.onSelect}
              variant={action.destructive ? 'destructive' : undefined}
            >
              <Icon className="h-3.5 w-3.5" />
              {action.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
