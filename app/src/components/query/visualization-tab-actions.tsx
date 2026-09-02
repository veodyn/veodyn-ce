'use client'

// The controls that ride the ACTIVE visualization tab: edit, publish, and the
// kebab holding delete. Extracted from visualization-tabs.tsx, which is where
// the state they drive still lives; this file is the presentational cluster.
import { MoreVertical, Pencil, ScreenShare, Trash2 } from 'lucide-react'
import type { MockVisualization } from '@/lib/mock-data'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/shared/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface VisualizationTabActionsProps {
  viz: MockVisualization
  canModify: boolean
  canDelete: boolean
  onEdit: () => void
  onPublish: () => void
  onDelete: () => void
}

export function VisualizationTabActions({
  viz,
  canModify,
  canDelete,
  onEdit,
  onPublish,
  onDelete,
}: VisualizationTabActionsProps) {
  return (
    <>
      {canModify && (
        /* Editing used to live behind the kebab next door, which reads as
           generic overflow: "how do I edit this chart?" is not a question a
           settings control should provoke. It gets its own labelled button,
           and the kebab keeps the destructive action, whose two clicks are
           the only thing standing between a stray click and a deleted
           visualization. */
        <IconButton
          tooltip="Edit visualization"
          aria-label={`Edit ${viz.name}`}
          variant="ghost"
          size="icon-xs"
          className="-ml-1"
          onClick={onEdit}
        >
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        </IconButton>
      )}
      <IconButton
        tooltip="Publish to a screen"
        aria-label={`Publish ${viz.name}`}
        variant="ghost"
        size="icon-xs"
        className={canModify ? undefined : '-ml-1'}
        onClick={onPublish}
      >
        <ScreenShare className="h-3.5 w-3.5 text-muted-foreground" />
      </IconButton>
      {canDelete && (
        <DropdownMenu>
          {/* The tooltip wraps the menu trigger rather than replacing it: the
              kebab has to stay the element that opens the menu, so the trigger
              renders through it. */}
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  aria-label={`More options for ${viz.name}`}
                  render={<Button variant="ghost" size="icon-xs" />}
                />
              }
            >
              <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>More options</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="min-w-[120px]">
            <DropdownMenuItem onClick={onDelete} variant="destructive">
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  )
}
