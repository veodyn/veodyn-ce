'use client'

import { ChevronDown, FileCode2, PanelRightOpen } from 'lucide-react'
import type { ReactNode } from 'react'
import { CodeBlock } from '@/components/shared/code-block'
import { IconButton } from '@/components/shared/icon-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { DraftView } from '@/lib/chat/thread-model'
import type { QueryResultData } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { ResultView } from './result-view'

interface DraftCardProps {
  draft: DraftView
  version: number
  data?: QueryResultData
  selected: boolean
  onSelect: () => void
  children?: ReactNode
}

export function DraftCard({ draft, version, data, selected, onSelect, children }: DraftCardProps) {
  const shown = draft.versions.find((one) => one.version === version) ?? draft.versions[draft.versions.length - 1]
  if (!shown) return null
  const latest = draft.versions[draft.versions.length - 1]?.version ?? shown.version
  const { payload } = shown
  return (
    <Card size="sm" className={cn('w-full', selected && 'ring-2 ring-primary')}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileCode2 className="size-4" aria-hidden="true" />
          <span className="truncate">{payload.name}</span>
          <Badge variant="secondary">v{shown.version}</Badge>
          {shown.version < latest ? <Badge variant="outline">revised later</Badge> : null}
        </CardTitle>
        {payload.description ? <CardDescription>{payload.description}</CardDescription> : null}
        <CardAction>
          <IconButton tooltip="Open beside the chat" variant="ghost" size="icon-sm" onClick={onSelect}>
            <PanelRightOpen aria-hidden="true" />
          </IconButton>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {data ? <ResultView data={data} vizChoiceId={payload.vizChoiceId} /> : null}
        <Collapsible>
          <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="-ml-2" />}>
            <ChevronDown aria-hidden="true" />
            SQL
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CodeBlock code={payload.sql} />
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
      {children && shown.version === latest ? <CardFooter className="flex flex-wrap gap-2">{children}</CardFooter> : null}
    </Card>
  )
}
