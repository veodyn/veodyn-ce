'use client'

import { FileCode2, LayoutDashboard, Search } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import type { CallView } from '@/lib/chat/thread-model'
import type { ChatLibraryResult } from '@/lib/chat/tool-results'
import { ToolCardTitle, ToolFailure } from './tool-card-parts'

export const NOTHING_FOUND = 'Nothing matched.'
export const MORE_FOUND = 'More items match than are listed.'

function moreFound(output: Pick<ChatLibraryResult, 'queryCount' | 'dashboardCount'>): string {
  const counts = [
    output.dashboardCount == null ? null : `${output.dashboardCount} dashboards`,
    output.queryCount == null ? null : `${output.queryCount} queries`,
  ].filter((part): part is string => part !== null)
  return counts.length > 0 ? `${counts.join(', ')} match; the first are listed.` : MORE_FOUND
}

export function itemHref(type: 'query' | 'dashboard', id: number): string {
  return type === 'query' ? `/queries/${id}` : `/dashboards/${id}`
}

export function LibraryCard({ call }: { call: CallView }) {
  const output = call.output?.kind === 'library' && call.output.ok ? call.output : null
  const items = output?.items ?? []
  return (
    <Card size="sm" className="w-full">
      <CardHeader>
        <ToolCardTitle icon={Search} running={call.status === 'running'}>
          {call.status === 'running' ? 'Searching the library…' : 'Library search'}
        </ToolCardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {call.status === 'failed' ? (
          <ToolFailure>{call.error ?? 'The search failed.'}</ToolFailure>
        ) : null}
        {output && items.length === 0 ? <p className="text-sm text-muted-foreground">{NOTHING_FOUND}</p> : null}
        {items.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {items.map((item) => (
              <li key={`${item.type}-${item.id}`} className="flex min-w-0 items-center gap-2 text-sm">
                {item.type === 'query' ? (
                  <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-label="Query" />
                ) : (
                  <LayoutDashboard className="size-4 shrink-0 text-muted-foreground" aria-label="Dashboard" />
                )}
                <Link href={itemHref(item.type, item.id)} className="truncate hover:underline">
                  {item.name}
                </Link>
                {item.type === 'query' && item.hasResult === false ? (
                  <Badge variant="outline">never run</Badge>
                ) : null}
                {(item.tags ?? []).slice(0, 3).map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </li>
            ))}
          </ul>
        ) : null}
        {output?.more ? <p className="text-xs text-muted-foreground">{moreFound(output)}</p> : null}
      </CardContent>
    </Card>
  )
}
