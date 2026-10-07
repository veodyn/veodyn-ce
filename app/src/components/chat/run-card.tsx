'use client'

import { ChevronDown, PanelRightOpen, RotateCw } from 'lucide-react'
import { CodeBlock } from '@/components/shared/code-block'
import { IconButton } from '@/components/shared/icon-button'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { RunView } from '@/lib/chat/thread-model'
import type { QueryResultData } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { ResultView } from './result-view'
import { ToolCardTitle, ToolFailure } from './tool-card-parts'

export function runStatusLabel(run: RunView): string {
  if (run.status === 'running') return 'Running in your browser…'
  if (run.status === 'failed') return 'The query failed'
  const rows = run.rowCount === null ? null : `${run.rowCount.toLocaleString()} ${run.rowCount === 1 ? 'row' : 'rows'}`
  const seconds = run.durationMs === null ? null : `${(run.durationMs / 1000).toFixed(1)} s`
  return [rows, seconds].filter(Boolean).join(' · ') || 'Done'
}

interface RunCardProps {
  run: RunView
  data?: QueryResultData
  error?: string
  selected: boolean
  onSelect: () => void
  onRerun: () => void
}

export function RunCard({ run, data, error, selected, onSelect, onRerun }: RunCardProps) {
  const message = error ?? run.error
  const canRerun = run.dataSourceId > 0
  return (
    <Card size="sm" className={cn('w-full', selected && 'ring-2 ring-primary')}>
      <CardHeader>
        <ToolCardTitle running={run.status === 'running'} failed={run.status === 'failed'}>
          <span className="truncate">{run.purpose || 'Query'}</span>
        </ToolCardTitle>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {runStatusLabel(run)}
        </p>
        <CardAction>
          <IconButton tooltip="Open beside the chat" variant="ghost" size="icon-sm" onClick={onSelect}>
            <PanelRightOpen aria-hidden="true" />
          </IconButton>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {data ? <ResultView data={data} vizChoiceId={run.vizChoiceId} /> : null}
        {!data && run.status === 'done' && canRerun ? (
          <Button variant="outline" size="sm" className="self-start" onClick={onRerun}>
            <RotateCw aria-hidden="true" />
            Run again to draw the chart
          </Button>
        ) : null}
        {message ? <ToolFailure>{message}</ToolFailure> : null}
        <Collapsible>
          <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="-ml-2" />}>
            <ChevronDown aria-hidden="true" />
            SQL
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CodeBlock code={run.sql} />
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  )
}
