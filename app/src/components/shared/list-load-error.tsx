'use client'

import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

// A list whose read failed, said out loud.
//
// The bug this exists to stop: a list built as `{ data }` with no `isError`
// renders a failed fetch through its empty state, so "No alerts configured" and
// "No data sources yet" are what a refused or timed-out request looks like.
// That is not a blank screen, it is a confident false statement, and the
// instructing empty states ("Add one so a triggered alert has somewhere to go")
// tell the reader to fix a problem they do not have.
//
// Nobody files it because it looks like an empty state. `favorites/page.tsx`
// already argues the principle in a comment: a failed read is not an empty
// shelf.
//
// The shape follows search-page-client, which got this right first: say it
// failed, and offer the retry, because a transient backend blip is the common
// case and reloading the whole page to find out is a poor answer.

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
        {/* Deliberately not "there are no X". The one thing this component must
            never imply is a count. */}
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
