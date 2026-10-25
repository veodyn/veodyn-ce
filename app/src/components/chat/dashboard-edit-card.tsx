'use client'

import { LayoutDashboard } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { DashboardOperation } from '@/lib/chat/dashboard-changes'
import { textTitle } from '@/lib/chat/dashboard-widgets'
import type { DashboardEditDraftView, DraftView } from '@/lib/chat/thread-model'
import { cn } from '@/lib/utils'

function draftName(queryDraftId: string, fallback: string, queryDrafts: Record<string, DraftView>): string {
  const draft = queryDrafts[queryDraftId]
  return draft?.versions[draft.versions.length - 1]?.payload.name ?? fallback
}

function at(position: DashboardOperation['position']): string {
  return `col ${position.col}, row ${position.row}`
}

function BeforeAfter({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-muted-foreground line-through decoration-muted-foreground/50">{before}</span>
      <span className="whitespace-pre-wrap">{after}</span>
    </div>
  )
}

function OperationRow({ operation, queryDrafts }: { operation: DashboardOperation; queryDrafts: Record<string, DraftView> }) {
  switch (operation.op) {
    case 'add': {
      const title =
        operation.queryDraftId === undefined
          ? operation.title
          : draftName(operation.queryDraftId, operation.title, queryDrafts)
      return <p className="text-sm">{`Add ${title} at ${at(operation.position)}`}</p>
    }
    case 'addText':
      return <p className="text-sm">{`Add text: ${textTitle(operation.text)}`}</p>
    case 'editText':
      return <BeforeAfter label="Edit text" before={operation.title} after={operation.text} />
    case 'move': {
      const { position } = operation
      return <p className="text-sm">{`Move ${operation.title} to ${at(position)}, ${position.sizeX} by ${position.sizeY}`}</p>
    }
    case 'remove':
      return <p className="text-sm text-destructive">{`Remove ${operation.title}`}</p>
  }
}

interface DashboardEditCardProps {
  draft: DashboardEditDraftView
  version: number
  queryDrafts: Record<string, DraftView>
  children?: ReactNode
}

export function DashboardEditCard({ draft, version, queryDrafts, children }: DashboardEditCardProps) {
  const shown = draft.versions.find((one) => one.version === version) ?? draft.versions[draft.versions.length - 1]
  if (!shown) return null
  const { dashboardId, snapshot, name, tags, operations } = shown.payload
  const changes = operations.length + (name !== undefined ? 1 : 0) + (tags !== undefined ? 1 : 0)
  return (
    <Card size="sm" className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <LayoutDashboard className="size-4" aria-hidden="true" />
          <span>Edit</span>
          <Link href={`/dashboards/${dashboardId}`} className="truncate hover:underline">
            {snapshot.name}
          </Link>
          <Badge variant="secondary">{changes === 1 ? '1 change' : `${changes} changes`}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {name !== undefined ? <BeforeAfter label="Name" before={snapshot.name} after={name} /> : null}
        {tags !== undefined ? (
          <BeforeAfter label="Tags" before={(snapshot.tags ?? []).join(', ') || 'none'} after={tags.join(', ') || 'none'} />
        ) : null}
        {operations.map((operation, index) => (
          <div key={index} className={cn(operation.op === 'remove' && 'rounded-md bg-destructive/10 px-2 py-1')}>
            <OperationRow operation={operation} queryDrafts={queryDrafts} />
          </div>
        ))}
      </CardContent>
      {children ? <CardFooter className="flex flex-wrap gap-2">{children}</CardFooter> : null}
    </Card>
  )
}
