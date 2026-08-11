'use client'

import { CircleSlash, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ScheduleSummary } from '@/lib/format-schedule'

// The schedule sits in the metadata row rather than beside the buttons, because
// it answers the same question as "Updated <when>": how current is this. The
// icon carries the state as well as the wording does, so an ended schedule is
// never distinguished by colour alone.
export function ScheduleIndicator({
  summary,
  onOpen,
}: {
  summary: ScheduleSummary
  onOpen: (() => void) | null
}) {
  const Icon = summary.ended ? CircleSlash : Clock
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
    <Button
      type="button"
      variant="ghost"
      onClick={onOpen}
      // `py-1 -my-1` grows the hit target without moving anything: this reads
      // as inline text in a metadata row, so it is deliberately not on the
      // button height/padding scale the size variants supply, but at 20px tall
      // it was under the 24px minimum target size. The negative margin gives
      // the padding back to the layout. The rest of the overrides neutralise
      // Button's own chrome (weight, background, click shift) so the control
      // still reads as inline text, not as a button.
      className="h-auto gap-1.5 rounded-sm px-0 py-1 -my-1 font-normal text-muted-foreground hover:bg-transparent hover:text-foreground active:translate-y-0 dark:hover:bg-transparent"
    >
      {content}
    </Button>
  )
}
