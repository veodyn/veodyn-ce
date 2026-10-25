import type { QueryResultData } from '@/lib/mock-data'
import type { DraftPreview } from './kpi-check'
import type { ThreadState } from './thread-model'

export function draftPreviewOf(
  state: ThreadState,
  results: Record<string, QueryResultData>,
  draftId: string
): DraftPreview | null {
  const payload = state.drafts[draftId]?.versions.at(-1)?.payload
  if (!payload) return null
  const run = Object.values(state.runs).find((one) => one.sql === payload.sql && one.dataSourceId === payload.dataSourceId && results[one.callId])
  return { name: payload.name, columns: run ? results[run.callId].columns.map((column) => column.name) : [] }
}
