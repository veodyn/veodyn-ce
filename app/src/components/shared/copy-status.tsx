import { Check, Copy, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { CopyStatus as CopyStatusValue } from '@/hooks/use-copy-to-clipboard'

const MESSAGES: Record<CopyStatusValue, string> = {
  idle: '',
  copied: 'Copied',
  failed: 'Copy failed',
}

export function copyTooltip(status: CopyStatusValue, idleLabel: string) {
  return MESSAGES[status] || idleLabel
}

export function CopyStatus({ status }: { status: CopyStatusValue }) {
  return (
    <span role="status" className="sr-only">
      {MESSAGES[status]}
    </span>
  )
}

export function CopyIcon({ status, className }: { status: CopyStatusValue; className?: string }) {
  if (status === 'copied') return <Check className={cn(className, 'text-status-fresh')} />
  if (status === 'failed') return <X className={cn(className, 'text-destructive')} />
  return <Copy className={className} />
}
