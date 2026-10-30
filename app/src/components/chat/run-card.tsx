'use client'

import { ChevronDown, PanelRightOpen, RotateCw } from 'lucide-react'
import Link from 'next/link'
import { CodeBlock } from '@/components/shared/code-block'
import { IconButton } from '@/components/shared/icon-button'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { isResultTooLargeMessage } from '@/lib/chat/result-cap'
import type { RunView } from '@/lib/chat/thread-model'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { ResultTooLarge, RESULT_TOO_LARGE_LABEL } from './result-too-large'
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
  visualization?: MockVisualization | null
  error?: string
  selected: boolean
  onSelect: () => void
  onRerun: () => void
}

export function RunCard({ run, data, visualization, error, selected, onSelect, onRerun }: RunCardProps) {
  const message = error ?? run.error
  const tooLarge = isResultTooLargeMessage(message)
  const failure = tooLarge ? <ResultTooLarge /> : message ? <ToolFailure>{message}</ToolFailure> : null
  const canRerun = run.dataSourceId > 0 || run.saved !== undefined
  return (
    <Card size="sm" className={cn('w-full', selected && 'ring-2 ring-primary')}>
      <CardHeader>
        <ToolCardTitle running={run.status === 'running'} failed={run.status === 'failed'}>
          <span className="truncate">{run.purpose || 'Query'}</span>
        </ToolCardTitle>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {tooLarge ? RESULT_TOO_LARGE_LABEL : runStatusLabel(run)}
        </p>
        <CardAction>
          <IconButton tooltip="Open beside the chat" variant="ghost" size="icon-sm" onClick={onSelect}>
            <PanelRightOpen aria-hidden="true" />
          </IconButton>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {data ? <ResultView data={data} vizChoiceId={run.vizChoiceId} visualization={visualization} /> : null}
        {!data && run.status === 'done' && canRerun ? (
          <Button variant="outline" size="sm" className="self-start" onClick={onRerun}>
            <RotateCw aria-hidden="true" />
            Run again to draw the chart
          </Button>
        ) : null}
        {failure}
        {run.saved ? (
          <Link href={`/queries/${run.saved.queryId}`} className="self-start text-sm text-muted-foreground hover:underline">
            Open the saved query
          </Link>
        ) : (
          <Collapsible>
            <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="-ml-2" />}>
              <ChevronDown aria-hidden="true" />
              SQL
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CodeBlock code={run.sql} />
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  )
}
