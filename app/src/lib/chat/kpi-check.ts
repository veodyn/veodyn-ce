import { readQueryError } from '@/lib/query-error'
import { ApiError } from '@/services/api-client'
import type { ChatToolRequestOf } from './frames'
import { NOT_AVAILABLE } from './library-results'
import * as nodeCalls from './node-calls'
import type { ChatToolResult } from './tool-results'
import { MAX_CHECKED_COLUMNS, type ChatKpiCheckResult } from './tool-results-contributed'
import type { RedashTransport } from './transport'

export interface DraftPreview {
  name: string
  columns: string[]
}

export type DraftPreviewLookup = (draftId: string) => DraftPreview | null

export function noQueryForKpi(queryId: number): string {
  return `No query ${queryId}`
}

function failed(error: string): ChatToolResult {
  return { kind: 'kpi_check', ok: false, error } as ChatKpiCheckResult
}

function names(columns: string[]): string[] {
  return columns.slice(0, MAX_CHECKED_COLUMNS)
}

export async function resolveKpiCheck(
  request: ChatToolRequestOf<'propose_kpi'>,
  transport: RedashTransport,
  signal: AbortSignal,
  draftPreview: DraftPreviewLookup = () => null
): Promise<ChatToolResult> {
  const { sourceQueryId, queryDraftId } = request.args
  if (queryDraftId !== null && sourceQueryId === null) {
    const preview = draftPreview(queryDraftId)
    return {
      kind: 'kpi_check',
      ok: true,
      sourceQueryId: null,
      queryDraftId,
      queryName: preview?.name ?? null,
      columns: names(preview?.columns ?? []),
    }
  }
  if (sourceQueryId === null) return failed('Name the saved query or the query draft the KPI reads.')
  try {
    const query = await nodeCalls.getQuery(transport, sourceQueryId, signal)
    if (!query || query.is_archived) return failed(noQueryForKpi(sourceQueryId))
    const stored = query.latest_query_data_id
    const columns =
      stored == null
        ? []
        : (await nodeCalls.getQueryResult(transport, stored, signal)).data.columns.map((column) => column.name)
    return {
      kind: 'kpi_check',
      ok: true,
      sourceQueryId,
      queryDraftId: null,
      queryName: query.name,
      columns: names(columns),
    }
  } catch (error) {
    if (signal.aborted) throw error
    if (error instanceof ApiError && error.status === 403) return failed(NOT_AVAILABLE)
    return failed(readQueryError(error).message)
  }
}
