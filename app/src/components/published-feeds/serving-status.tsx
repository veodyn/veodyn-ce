import { CircleCheck, CircleMinus, CircleOff, CircleSlash, CircleHelp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PublishAttempt } from '@/types/published-feed'

// Serving state, which is NOT binding state. The binding's `bindingState` is
// only fresh in a write response (both read paths hard-code `unknown`), so
// nothing on a read path may render it as mapping validity. What a reader can
// be told honestly is whether anything is being served, and that comes from
// the attempt record.
//
// Status is icon plus word plus a semantic token, never colour alone, matching
// FEED_STATUS_META on the Feed Health board next door.
const META = {
  serving: { label: 'Serving', Icon: CircleCheck, text: 'text-status-fresh' },
  notServing: { label: 'Not serving', Icon: CircleMinus, text: 'text-muted-foreground' },
  blocked: { label: 'Blocked', Icon: CircleSlash, text: 'text-destructive' },
  failed: { label: 'Failed', Icon: CircleOff, text: 'text-destructive' },
  never: { label: 'Never published', Icon: CircleHelp, text: 'text-muted-foreground' },
} as const

export type ServingState = keyof typeof META

export function servingState(attempt: PublishAttempt | undefined): ServingState {
  if (!attempt) return 'never'
  if (attempt.isCurrent) return 'serving'
  if (attempt.decision === 'blocked') return 'blocked'
  // A published attempt that is no longer current did not fail. It produced
  // bytes, they passed, and they were served; then an edit or a delete retired
  // the declaration they answered for and cleared the pointer under them
  // (`take_the_feed_off_the_air`). Calling that "Failed" put one decision on
  // screen as another, three lines above an attempt history saying "Published"
  // about the same row.
  if (attempt.decision === 'published') return 'notServing'
  return 'failed'
}

export function ServingStatus({ attempt }: { attempt: PublishAttempt | undefined }) {
  const { label, Icon, text } = META[servingState(attempt)]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', text)}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </span>
  )
}
