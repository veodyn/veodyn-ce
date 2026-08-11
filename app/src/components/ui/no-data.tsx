import { AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface NoDataProps {
  // ReactNode, not string: several call sites need a link or a conditional
  // fragment in the message, and a string type forced them to hand-roll the
  // whole empty state instead.
  message?: ReactNode
  icon?: ReactNode
  // Card chrome is opt-in. The bare form is right inside a panel that already
  // has a border; the card form replaces the hand-rolled empty states that sat
  // directly on the page background.
  card?: boolean
  className?: string
}

export function NoData({
  message = 'No data available',
  icon,
  card = false,
  className,
}: NoDataProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center p-8 text-muted-foreground',
        card && 'rounded-lg border bg-card text-center',
        className
      )}
    >
      {icon ?? <AlertCircle className="h-10 w-10 mb-3 opacity-50" />}
      <div className="text-sm">{message}</div>
    </div>
  )
}
