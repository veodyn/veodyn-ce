'use client'

import { useEffect, useState } from 'react'
import { formatAgeProse } from '@/lib/format-datetime'
import { cn } from '@/lib/utils'

// The one treatment for a relative timestamp, applied here rather than left to
// each caller. Callers had split into two camps: the tables (/queries,
// /dashboards, /favorites) passed only `text-muted-foreground` and so rendered
// at Geist 14px, while the cards and grids (/, /discover, /data) passed
// `font-mono text-xs tabular-nums`. The same string, "9 hours ago", was sans 14
// on one screen and mono 12 on the next for the very same query.
//
// Mono and tabular wins because this is numeric text that gets scanned down a
// column, which is the tabular-figures rule the rest of the app already
// follows. A caller may still override: cn puts its className last.
const TIME_STYLE = 'font-mono text-xs tabular-nums text-muted-foreground'

interface TimeAgoProps {
  date: string | Date
  className?: string
}

// date-fns' formatDistanceToNow hedged every label ("about 2 months ago",
// "almost 2 years ago") and used its own thresholds, which is the second scale
// that made a widget say 129d while the prose beside it said 4 months. The
// shared ladder is exact and unhedged.
function format(date: string | Date): string {
  if (!date) return 'Never'
  return formatAgeProse(date, Date.now())
}

export function TimeAgo({ date, className }: TimeAgoProps) {
  // Tick purely to re-render as time passes. The text is derived on every
  // render instead of being held in state: state seeded with useState(initial)
  // ignores later prop changes, which left labels like "Last evaluated" frozen
  // for up to a minute after the underlying timestamp actually moved.
  const [, setTick] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000)
    return () => clearInterval(interval)
  }, [])

  return <span className={cn(TIME_STYLE, className)}>{format(date)}</span>
}
