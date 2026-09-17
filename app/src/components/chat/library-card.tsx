'use client'

import { AlertCircle, FileCode2, LayoutDashboard, Loader2, Search } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { CallView } from '@/lib/chat/thread-model'

export const NOTHING_FOUND = 'Nothing matched.'
export const MORE_FOUND = 'More items match. Ask with more specific words to narrow it down.'

export function itemHref(type: 'query' | 'dashboard', id: number): string {
  return type === 'query' ? `/queries/${id}` : `/dashboards/${id}`
}

export function LibraryCard({ call }: { call: CallView }) {
  const output = call.output?.kind === 'library' && call.output.ok ? call.output : null
  const items = output?.items ?? []
  return (
    <Card size="sm" className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {call.status === 'running' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="size-4" aria-hidden="true" />
          )}
          {call.status === 'running' ? 'Searching the library…' : 'Library search'}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {call.status === 'failed' ? (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4" aria-hidden="true" />
            {call.error ?? 'The search failed.'}
          </p>
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
        {output?.more ? <p className="text-xs text-muted-foreground">{MORE_FOUND}</p> : null}
      </CardContent>
    </Card>
  )
}
