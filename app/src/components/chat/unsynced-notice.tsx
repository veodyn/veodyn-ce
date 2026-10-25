'use client'

import { Button } from '@/components/ui/button'

export const UNSYNCED_MESSAGE = 'Saved, but the record of it did not save.'

export function UnsyncedNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="status" className="flex w-full flex-wrap items-center gap-2 text-sm">
      <p className="text-pretty">{UNSYNCED_MESSAGE}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}
