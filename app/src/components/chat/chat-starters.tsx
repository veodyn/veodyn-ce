'use client'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const CHAT_STARTERS = [
  'What dashboards do we have?',
  'Which saved queries cover bikeshare?',
  'What data can I explore here?',
]

interface ChatStartersProps {
  onPick: (text: string) => void
  disabled: boolean
  className?: string
}

export function ChatStarters({ onPick, disabled, className }: ChatStartersProps) {
  return (
    <div role="group" aria-label="Suggested questions" className={cn('flex flex-wrap gap-2', className)}>
      {CHAT_STARTERS.map((text) => (
        <Button
          key={text}
          variant="outline"
          size="sm"
          className="rounded-full font-normal"
          disabled={disabled}
          onClick={() => onPick(text)}
        >
          {text}
        </Button>
      ))}
    </div>
  )
}
