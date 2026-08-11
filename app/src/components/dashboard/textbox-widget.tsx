'use client'

import { Pencil, Trash2, GripVertical } from 'lucide-react'
import { IconButton } from '@/components/shared/icon-button'
import { TextboxMarkdown } from '@/components/dashboard/textbox-markdown'

interface TextboxWidgetProps {
  text: string
  isEditing?: boolean
  onEdit?: () => void
  onRemove?: () => void
}

export function TextboxWidget({ text, isEditing, onEdit, onRemove }: TextboxWidgetProps) {
  return (
    <div className="h-full bg-card rounded-lg border flex flex-col overflow-hidden">
      {isEditing && (
        <div className="flex items-center justify-between px-2 py-1 border-b bg-muted/50">
          <div className="widget-drag-handle cursor-move p-1">
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="flex items-center gap-1">
            <IconButton tooltip="Edit text" variant="ghost" size="icon-sm" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
            </IconButton>
            <IconButton tooltip="Remove textbox" variant="ghost" size="icon-sm" onClick={onRemove}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </IconButton>
          </div>
        </div>
      )}
      <div className="flex-1 p-4 overflow-auto">
        {/* The same component the dialog previews with, so what an author is
            shown while editing is what every reader of the dashboard gets. */}
        <TextboxMarkdown text={text} />
      </div>
    </div>
  )
}
