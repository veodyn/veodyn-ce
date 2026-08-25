'use client'

import { useId } from 'react'
import { Play, Save, AlignLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

interface EditorControlsProps {
  onExecute: () => void
  onSave: () => void
  onFormat: () => void
  isExecuting: boolean
  isSaving: boolean
  isDirty: boolean
  autoLimit: boolean
  onAutoLimitChange: (value: boolean) => void
  /** Hidden for non-SQL data sources: LIMIT is not a thing their query text has. */
  showAutoLimit: boolean
}

export function EditorControls({
  onExecute,
  onSave,
  onFormat,
  isExecuting,
  isSaving,
  isDirty,
  autoLimit,
  onAutoLimitChange,
  showAutoLimit,
}: EditorControlsProps) {
  const autoLimitId = useId()

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b bg-card">
      {/* "Run", the same word the Visual builder's button uses, because it is
          the same action: send the SQL to the data source and land the rows in
          the pane below. This said "Execute" while Visual said "Run", so one
          editor asked for two verbs depending on which half you were in. The
          props and hooks around it stay `execute`: that is Redash's own word
          for the API call, and it is not read by anyone using the product. */}
      <Button onClick={onExecute} disabled={isExecuting}>
        {isExecuting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Play className="h-4 w-4" />
        )}
        Run
      </Button>
      <Button variant="outline" onClick={onSave} disabled={isSaving || !isDirty}>
        {isSaving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        Save{isDirty ? ' *' : ''}
      </Button>
      <Button variant="outline" onClick={onFormat}>
        <AlignLeft className="h-4 w-4" />
        Format
      </Button>
      <div className="flex-1" />
      {showAutoLimit && (
        <div className="flex items-center gap-1.5">
          <Checkbox id={autoLimitId} checked={autoLimit} onCheckedChange={onAutoLimitChange} />
          <Label htmlFor={autoLimitId} className="text-xs text-muted-foreground cursor-pointer">
            LIMIT 1000
          </Label>
        </div>
      )}
    </div>
  )
}
