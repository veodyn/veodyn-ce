'use client'

import { BarChart3 } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { useQueryById } from '@/hooks/use-queries'
import { useQueryResult } from '@/hooks/use-query-execution'
import type { VizDraftView } from '@/lib/chat/thread-model'
import { optionChanges } from '@/lib/chat/viz-summary'
import type { MockVisualization } from '@/lib/mock-data'
import { ResultView } from './result-view'

const MODE_LABEL = { new: 'Add visualization', edit: 'Edit visualization', delete: 'Delete visualization' } as const
const PREVIEW_CHOICE = 'table'

function previewOf(next: { type: string; name: string; options: Record<string, unknown> }): MockVisualization {
  return { id: -1, ...next, description: '', created_at: '', updated_at: '' }
}

interface VizDraftCardProps {
  draft: VizDraftView
  version: number
  children?: ReactNode
}

function ChangeRow({ label, before, after }: { label: string; before: string | null; after: string | null }) {
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {before !== null ? (
        <span className="text-muted-foreground line-through decoration-muted-foreground/50">{before}</span>
      ) : null}
      <span>{after ?? 'removed'}</span>
    </div>
  )
}

export function VizDraftCard({ draft, version, children }: VizDraftCardProps) {
  const shown = draft.versions.find((one) => one.version === version) ?? draft.versions[draft.versions.length - 1]
  const payload = shown?.payload
  const query = useQueryById(payload?.queryId)
  const stored = useQueryResult(query.data?.latest_query_data_id)
  if (!shown || !payload) return null
  const before = payload.mode === 'new' ? null : payload.snapshot
  const next = payload.mode === 'delete' ? null : payload.next
  const headline = before ?? next
  const data = stored.data?.data
  const rows = next
    ? [
        ...(before && before.name !== next.name ? [{ key: 'name', label: 'Name', before: before.name, after: next.name }] : []),
        ...(before && before.type !== next.type ? [{ key: 'type', label: 'Type', before: before.type, after: next.type }] : []),
        ...optionChanges(before?.options ?? {}, next.options).map((one) => ({ ...one, label: one.key })),
      ]
    : []
  return (
    <Card size="sm" className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <BarChart3 className="size-4" aria-hidden="true" />
          <span>{MODE_LABEL[payload.mode]}</span>
          <Link href={`/queries/${payload.queryId}`} className="truncate hover:underline">
            {headline?.name}
          </Link>
          <Badge variant="secondary">{headline?.type}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.map((row) => (
          <ChangeRow key={row.key} label={row.label} before={row.before} after={row.after} />
        ))}
        {next && data ? <ResultView data={data} vizChoiceId={PREVIEW_CHOICE} visualization={previewOf(next)} /> : null}
      </CardContent>
      {children ? <CardFooter className="flex flex-wrap gap-2">{children}</CardFooter> : null}
    </Card>
  )
}
