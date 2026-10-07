import { AlertCircle, Loader2, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { CardTitle } from '@/components/ui/card'

interface ToolCardTitleProps {
  icon?: LucideIcon
  running: boolean
  failed?: boolean
  children: ReactNode
}

export function ToolCardTitle({ icon: Icon, running, failed = false, children }: ToolCardTitleProps) {
  return (
    <CardTitle className="flex items-center gap-2 text-sm">
      {running ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {!running && failed ? <AlertCircle className="size-4 text-destructive" aria-hidden="true" /> : null}
      {!running && !failed && Icon ? <Icon className="size-4" aria-hidden="true" /> : null}
      {children}
    </CardTitle>
  )
}

export function ToolFailure({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-pretty text-sm text-destructive">
      <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
      {children}
    </p>
  )
}
