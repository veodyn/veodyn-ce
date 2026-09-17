'use client'

import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { CodeBlock } from '@/components/shared/code-block'
import { IconButton } from '@/components/shared/icon-button'
import type { QueryResultData } from '@/lib/mock-data'
import { ResultView } from './result-view'

export const PANE_TABLE_ROWS = 1_000

interface DetailPaneProps {
  title: string
  sql: string
  vizChoiceId: string
  data?: QueryResultData
  onClose: () => void
  actions?: ReactNode
  chart?: ReactNode
}

export function DetailPane({ title, sql, vizChoiceId, data, onClose, actions, chart }: DetailPaneProps) {
  const table = data ? { ...data, rows: data.rows.slice(0, PANE_TABLE_ROWS) } : undefined
  return (
    <aside aria-label={`Details: ${title}`} className="flex h-full min-h-0 flex-col border-l bg-background">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
        {actions}
        <IconButton tooltip="Close" variant="ghost" size="icon-sm" onClick={onClose}>
          <X aria-hidden="true" />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {chart ?? (data ? (
          <ResultView data={data} vizChoiceId={vizChoiceId} className="h-96" />
        ) : (
          <p className="text-sm text-muted-foreground">Run the query to see its result here.</p>
        ))}
        <CodeBlock code={sql} />
        {table ? (
          <>
            <p className="text-xs text-muted-foreground">
              {data && data.rows.length > PANE_TABLE_ROWS
                ? `The first ${PANE_TABLE_ROWS.toLocaleString()} of ${data.rows.length.toLocaleString()} rows`
                : `${table.rows.length.toLocaleString()} rows`}
            </p>
            <ResultView data={table} vizChoiceId="table" className="h-96" />
          </>
        ) : null}
      </div>
    </aside>
  )
}
