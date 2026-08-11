'use client'

// Every dialog the query editor's source menu opens. Extracted from
// query-editor-page.tsx so the page stays a layout: at most one of these is
// open at a time, so the page tracks a single open-dialog name.
import { ScheduleDialog } from './schedule-dialog'
import { EmbedDialog } from './embed-dialog'
import { ApiKeyDialog } from './api-key-dialog'
import { AddToDashboardDialog } from './add-to-dashboard-dialog'
import { PermissionsEditorDialog } from './permissions-editor-dialog'
import type { MockQuery } from '@/lib/mock-data'

export type QueryEditorDialog =
  | 'schedule'
  | 'embed'
  | 'apiKey'
  | 'addToDashboard'
  | 'permissions'

type QuerySchedule = {
  interval: number | null
  time: string | null
  day_of_week: string | null
  until: string | null
} | null

interface QueryEditorDialogsProps {
  query: MockQuery
  open: QueryEditorDialog | null
  onClose: () => void
  onSaveSchedule: (schedule: QuerySchedule) => void
}

export function QueryEditorDialogs({
  query,
  open,
  onClose,
  onSaveSchedule,
}: QueryEditorDialogsProps) {
  return (
    <>
      <ScheduleDialog
        open={open === 'schedule'}
        onClose={onClose}
        schedule={query.schedule as QuerySchedule}
        onSave={onSaveSchedule}
      />
      <EmbedDialog
        open={open === 'embed'}
        onClose={onClose}
        visualizationId={query.visualizations[0]?.id ?? 0}
        isSafe={query.is_safe}
        shareToken={query.visualizations[0]?.api_key ?? null}
      />
      <ApiKeyDialog
        open={open === 'apiKey'}
        onClose={onClose}
        queryId={query.id}
        apiKey={query.api_key}
      />
      <AddToDashboardDialog
        open={open === 'addToDashboard'}
        onClose={onClose}
        queryId={query.id}
        visualizations={query.visualizations}
      />
      <PermissionsEditorDialog
        open={open === 'permissions'}
        onClose={onClose}
        objectId={query.id}
        authorId={query.user.id}
      />
    </>
  )
}
