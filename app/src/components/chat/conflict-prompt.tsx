'use client'

import { Button } from '@/components/ui/button'

interface ConflictPromptProps {
  message: string
  overwriteLabel: string
  keepLabel: string
  onOverwrite: () => void
  onKeep: () => void
}

export function ConflictPrompt({ message, overwriteLabel, keepLabel, onOverwrite, onKeep }: ConflictPromptProps) {
  return (
    <div role="alert" className="flex w-full flex-col gap-2 text-sm">
      <p className="text-pretty">{message}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="destructive" onClick={onOverwrite}>
          {overwriteLabel}
        </Button>
        <Button size="sm" variant="outline" onClick={onKeep}>
          {keepLabel}
        </Button>
      </div>
    </div>
  )
}
