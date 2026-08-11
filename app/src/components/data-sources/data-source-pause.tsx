'use client'

import { useId, useState } from 'react'
import { PauseCircle, PlayCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePauseDataSource, useResumeDataSource } from '@/hooks/use-data-sources'

interface DataSourcePauseProps {
  id: number
  /** Redash sends this as 0/1 rather than a boolean. */
  paused: number
  pauseReason: string | null
}

/**
 * Pausing stops every query and alert behind this source at once, which is the
 * point: the alternative when a feed goes bad is disabling schedules one query
 * at a time while the dashboards keep serving nonsense.
 */
export function DataSourcePause({ id, paused, pauseReason }: DataSourcePauseProps) {
  const [reason, setReason] = useState('')
  const reasonId = useId()
  const pause = usePauseDataSource()
  const resume = useResumeDataSource()
  const isPaused = paused === 1
  const busy = pause.isPending || resume.isPending

  if (isPaused) {
    return (
      <Card className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <PauseCircle className="h-4 w-4" aria-hidden="true" />
              Paused
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Queries and alerts using this source will not run.
            </p>
            {/* Shown rather than kept in the API response only: whoever finds
                the source paused should learn why without asking. */}
            {pauseReason && <p className="mt-2 text-sm">{pauseReason}</p>}
          </div>
          <Button variant="outline" onClick={() => resume.mutate(id)} disabled={busy}>
            <PlayCircle className="h-4 w-4" aria-hidden="true" />
            Resume
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <Card className="p-4">
      <div className="text-sm font-medium">Pause this data source</div>
      <p className="mt-1 mb-3 text-sm text-muted-foreground">
        Stops every query and alert behind it until it is resumed.
      </p>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label htmlFor={reasonId} className="mb-1 block">Reason</Label>
          <Input
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional, shown wherever the source appears"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => pause.mutate({ id, reason })}
          disabled={busy}
        >
          <PauseCircle className="h-4 w-4" aria-hidden="true" />
          Pause
        </Button>
      </div>
    </Card>
  )
}
