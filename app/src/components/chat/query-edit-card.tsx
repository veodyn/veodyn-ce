'use client'

import { Pencil } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { fieldChanges, lineDiff, type DiffLine } from '@/lib/chat/query-edit-summary'
import type { EditDraftView } from '@/lib/chat/thread-model'
import { cn } from '@/lib/utils'

const LINE_MARK: Record<DiffLine['kind'], string> = { same: ' ', added: '+', removed: '-' }
const LINE_STYLE: Record<DiffLine['kind'], string> = {
  same: 'text-muted-foreground',
  added: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  removed: 'bg-red-500/10 text-red-700 dark:text-red-300',
}

function SqlDiff({ before, after }: { before: string; after: string }) {
  const lines = lineDiff(before, after)
  return (
    <pre aria-label="SQL changes" className="max-h-64 overflow-auto rounded-md border bg-muted/30 py-1 font-mono text-xs">
      {lines.map((line, index) => (
        <div key={index} className={cn('whitespace-pre px-2', LINE_STYLE[line.kind])}>
          {LINE_MARK[line.kind]} {line.text}
        </div>
      ))}
    </pre>
  )
}

interface QueryEditCardProps {
  draft: EditDraftView
  version: number
  children?: ReactNode
}

export function QueryEditCard({ draft, version, children }: QueryEditCardProps) {
  const shown = draft.versions.find((one) => one.version === version) ?? draft.versions[draft.versions.length - 1]
  if (!shown) return null
  const { queryId, snapshot, changes } = shown.payload
  const rows = fieldChanges(snapshot, changes)
  return (
    <Card size="sm" className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Pencil className="size-4" aria-hidden="true" />
          <span>Edit</span>
          <Link href={`/queries/${queryId}`} className="truncate hover:underline">
            {snapshot.name}
          </Link>
          <Badge variant="secondary">{rows.length + (changes.sql !== undefined ? 1 : 0)} changes</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.field} className="flex flex-col gap-0.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">{row.label}</span>
            <span className="text-muted-foreground line-through decoration-muted-foreground/50">{row.before}</span>
            <span>{row.after}</span>
          </div>
        ))}
        {changes.sql !== undefined ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">SQL</span>
            <SqlDiff before={snapshot.sql} after={changes.sql} />
          </div>
        ) : null}
      </CardContent>
      {children ? <CardFooter className="flex flex-wrap gap-2">{children}</CardFooter> : null}
    </Card>
  )
}
