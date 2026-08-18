'use client'

import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

// A list whose read failed, said out loud.
//
// The bug this exists to stop: a list built as `{ data }` with no `isError`
// renders a failed fetch through its empty state, so "No alerts configured" is
// what a refused or timed-out request looks like. Shape follows
// search-page-client: say it failed, and offer the retry.

interface ListLoadErrorProps {
  /** What could not be read, lower case and plural: "alerts", "data sources". */
  noun: string
  onRetry?: () => void
}

export function ListLoadError({ noun, onRetry }: ListLoadErrorProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <AlertCircle className="h-10 w-10 text-destructive opacity-70" />
      <div className="text-sm text-muted-foreground">
        {/* Never "there are no X": this copy must not imply a count. */}
        Could not load {noun}. The request was refused or did not come back, so
        this list is not showing what exists.
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}
