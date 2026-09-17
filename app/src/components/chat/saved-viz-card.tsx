'use client'

import { AlertCircle, BarChart3, Loader2, PanelRightOpen, RotateCw } from 'lucide-react'
import Link from 'next/link'
import { IconButton } from '@/components/shared/icon-button'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { VisualizationRenderer } from '@/components/visualizations/visualization-renderer'
import { useSavedVisualization, type SavedVisualization } from '@/hooks/use-saved-visualization'
import type { CallView } from '@/lib/chat/thread-model'
import { formatDateTime } from '@/lib/format-datetime'
import { cn } from '@/lib/utils'
import { visualizationData } from '@/lib/visualizations/data-gate'

export const NEEDS_PARAMETERS = 'This query takes parameters. Open it to choose values and run it.'
export const NEVER_RAN = 'This query has not been run yet.'

export function SavedChart({ saved, className }: { saved: SavedVisualization; className?: string }) {
  const { visualization, data, loading, query } = saved
  if (!visualization) return null
  const drawable = visualizationData(visualization.type, data)
  return (
    <div className={cn('h-72 min-h-0 overflow-auto rounded-md border bg-background', className)}>
      {drawable ? (
        <VisualizationRenderer visualization={visualization} data={drawable} />
      ) : (
        <p className="p-4 text-sm text-muted-foreground">
          {loading ? 'Loading the stored result…' : query?.latest_query_data_id == null ? NEVER_RAN : 'No rows.'}
        </p>
      )}
    </div>
  )
}

export function RunControls({ saved }: { saved: SavedVisualization }) {
  if (!saved.query) return null
  const never = saved.query.latest_query_data_id == null
  if (!saved.canRun) {
    return never ? <p className="text-sm text-muted-foreground">{NEEDS_PARAMETERS}</p> : null
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={saved.run} disabled={saved.running}>
        {saved.running ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RotateCw aria-hidden="true" />}
        {never ? 'Run' : 'Refresh'}
      </Button>
      {saved.runError ? <span className="text-sm text-destructive">{saved.runError}</span> : null}
    </div>
  )
}

interface SavedVizCardProps {
  call: CallView
  selected: boolean
  onSelect: () => void
}

export function SavedVizCard({ call, selected, onSelect }: SavedVizCardProps) {
  const saved = useSavedVisualization(call)
  const { query, visualization, retrievedAt } = saved
  return (
    <Card size="sm" className={cn('w-full', selected && 'ring-2 ring-primary')}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {call.status === 'running' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <BarChart3 className="size-4" aria-hidden="true" />
          )}
          {query ? (
            <Link href={`/queries/${query.id}`} className="truncate hover:underline">
              {query.name}
            </Link>
          ) : (
            <span>Saved chart</span>
          )}
        </CardTitle>
        <CardDescription>
          {[visualization?.name, retrievedAt ? `as of ${formatDateTime(retrievedAt)}` : null]
            .filter(Boolean)
            .join(' · ')}
        </CardDescription>
        {visualization ? (
          <CardAction>
            <IconButton tooltip="Open beside the chat" variant="ghost" size="icon-sm" onClick={onSelect}>
              <PanelRightOpen aria-hidden="true" />
            </IconButton>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {call.status === 'failed' && !visualization ? (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4" aria-hidden="true" />
            {call.error ?? 'The chart could not be shown.'}
          </p>
        ) : null}
        <SavedChart saved={saved} />
        <RunControls saved={saved} />
      </CardContent>
    </Card>
  )
}
