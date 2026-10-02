'use client'

import { AlertCircle, Database, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { CallView } from '@/lib/chat/thread-model'

export const NO_SOURCES_FOUND = 'No data sources are available to the analyst.'

export function DataSourcesCard({ call }: { call: CallView }) {
  const output = call.output?.kind === 'data_sources' && call.output.ok ? call.output : null
  const sources = output?.sources ?? []
  return (
    <Card size="sm" className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {call.status === 'running' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Database className="size-4" aria-hidden="true" />
          )}
          {call.status === 'running' ? 'Listing data sources…' : 'Data sources'}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {call.status === 'failed' ? (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4" aria-hidden="true" />
            {call.error ?? 'The data sources could not be listed.'}
          </p>
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
