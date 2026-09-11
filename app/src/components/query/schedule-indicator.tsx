'use client'

import { CalendarPlus, CircleSlash, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { INLINE_TEXT_CONTROL } from '@/lib/inline-text-control'
import { cn } from '@/lib/utils'
import type { ScheduleSummary } from '@/lib/format-schedule'

// The schedule sits in the metadata row rather than beside the buttons, because
// it answers the same question as "Updated <when>": how current is this. The
// icon carries the state as well as the wording does, so an ended schedule is
// never distinguished by colour alone.
const ICONS = {
  set: Clock,
  ended: CircleSlash,
  unset: CalendarPlus,
} as const

export function ScheduleIndicator({
  summary,
  onOpen,
}: {
  summary: ScheduleSummary
  onOpen: (() => void) | null
}) {
  const Icon = ICONS[summary.state]

  // "No refresh schedule" is an invitation to set one. To a reader who may not,
  // it is a line of the header spent reporting that something they cannot do
  // has not been done, so they get the row back instead.
  if (summary.state === 'unset' && !onOpen) return null

  const content = (
    <>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {summary.text}
    </>
  )

  // Plain text for a reader who cannot edit the query: a control that opens a
  // dialog whose Save the backend would refuse is worse than no control.
  if (!onOpen) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        {content}
      </span>
    )
  }

  return (
    <Button type="button" variant="ghost" onClick={onOpen} className={cn(INLINE_TEXT_CONTROL, 'gap-1.5')}>
      {content}
    </Button>
  )
}
