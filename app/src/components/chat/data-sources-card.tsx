'use client'

import { Database } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import type { CallView } from '@/lib/chat/thread-model'
import { ToolCardTitle, ToolFailure } from './tool-card-parts'

export const NO_SOURCES_FOUND = 'No data sources are available to the analyst.'

export function DataSourcesCard({ call }: { call: CallView }) {
  const output = call.output?.kind === 'data_sources' && call.output.ok ? call.output : null
  const sources = output?.sources ?? []
  return (
    <Card size="sm" className="w-full">
      <CardHeader>
        <ToolCardTitle icon={Database} running={call.status === 'running'}>
          {call.status === 'running' ? 'Listing data sources…' : 'Data sources'}
        </ToolCardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {call.status === 'failed' ? (
          <ToolFailure>{call.error ?? 'The data sources could not be listed.'}</ToolFailure>
        ) : null}
        {output && sources.length === 0 ? <p className="text-sm text-muted-foreground">{NO_SOURCES_FOUND}</p> : null}
        {sources.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {sources.map((source) => (
              <li key={source.id} className="flex min-w-0 items-center gap-2 text-sm">
                <span className="truncate">{source.name}</span>
                <Badge variant="secondary">{source.type}</Badge>
                {source.viewOnly ? <Badge variant="outline">view only</Badge> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}
