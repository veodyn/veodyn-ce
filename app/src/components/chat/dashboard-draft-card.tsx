'use client'

import { LayoutDashboard } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { DashboardDraftView, DraftView } from '@/lib/chat/thread-model'
import type { QueryResultData } from '@/lib/mock-data'
import { ResultView } from './result-view'

interface DashboardDraftCardProps {
  draft: DashboardDraftView
  version: number
  queryDrafts: Record<string, DraftView>
  resultForSql: (sql: string) => QueryResultData | undefined
  children?: ReactNode
}

function itemTitle(
  item: DashboardDraftView['versions'][number]['payload']['items'][number],
  queryDrafts: Record<string, DraftView>
): string {
  if (item.title) return item.title
  if (item.kind === 'existing') return `Query ${item.queryId}`
  const queryDraft = queryDrafts[item.queryDraftId]
  return queryDraft?.versions[queryDraft.versions.length - 1]?.payload.name ?? item.queryDraftId
}

export function DashboardDraftCard({ draft, version, queryDrafts, resultForSql, children }: DashboardDraftCardProps) {
  const shown = draft.versions.find((one) => one.version === version) ?? draft.versions[draft.versions.length - 1]
  if (!shown) return null
  const latest = draft.versions[draft.versions.length - 1]?.version ?? shown.version
  const { payload } = shown
  return (
    <Card size="sm" className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <LayoutDashboard className="size-4" aria-hidden="true" />
          <span className="truncate">{payload.name}</span>
          <Badge variant="secondary">v{shown.version}</Badge>
          {shown.version < latest ? <Badge variant="outline">revised later</Badge> : null}
        </CardTitle>
        {payload.description ? <CardDescription>{payload.description}</CardDescription> : null}
        <CardAction>
          <Badge variant="outline">
            {payload.items.length} {payload.items.length === 1 ? 'chart' : 'charts'}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {payload.items.map((item, index) => {
            const queryDraft = item.kind === 'draft' ? queryDrafts[item.queryDraftId] : undefined
            const draftPayload = queryDraft?.versions[queryDraft.versions.length - 1]?.payload
            const data = draftPayload ? resultForSql(draftPayload.sql) : undefined
            return (
              <li
                key={item.kind === 'draft' ? item.queryDraftId : `${item.queryId}-${item.visualizationId}`}
                className="flex flex-col gap-1"
              >
                <span className="truncate text-sm">
                  {index + 1}. {itemTitle(item, queryDrafts)}
                </span>
                {data && draftPayload ? <ResultView data={data} vizChoiceId={draftPayload.vizChoiceId} className="max-h-40" /> : null}
              </li>
            )
          })}
        </ul>
      </CardContent>
      {children && shown.version === latest ? <CardFooter className="flex flex-wrap gap-2">{children}</CardFooter> : null}
    </Card>
  )
}
