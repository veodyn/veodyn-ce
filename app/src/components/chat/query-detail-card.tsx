'use client'

import { FileCode2 } from 'lucide-react'
import Link from 'next/link'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { knownOutput } from '@/lib/chat/thread-calls'
import type { CallView } from '@/lib/chat/thread-model'
import { ToolCardTitle, ToolFailure } from './tool-card-parts'

export function QueryDetailCard({ call }: { call: CallView }) {
  const known = knownOutput(call)
  const output = known?.kind === 'query_detail' && known.ok ? known : null
  const query = output?.query
  const parameters = (query?.parameters ?? []).map((one) => String(one.name))
  return (
    <Card size="sm" className="w-full">
      <CardHeader>
        <ToolCardTitle icon={FileCode2} running={call.status === 'running'} failed={call.status === 'failed'}>
          {query ? (
            <Link href={`/queries/${query.id}`} className="truncate hover:underline">
              {query.name}
            </Link>
          ) : (
            <span>{call.status === 'running' ? 'Opening the query…' : 'Query'}</span>
          )}
        </ToolCardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm">
        {call.status === 'failed' ? <ToolFailure>{call.error ?? 'The query could not be opened.'}</ToolFailure> : null}
        {query ? (
          <>
            <p className="text-muted-foreground">
              {parameters.length > 0 ? `Parameters: ${parameters.join(', ')}` : 'No parameters.'}
            </p>
            <p className="text-xs text-muted-foreground">
              {query.canEdit ? 'You can edit this query.' : 'You cannot edit this query.'}
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
