import { readQueryError } from '@/lib/query-error'
import { ApiError } from '@/services/api-client'
import type { RedashQuery, RedashSchedule } from '@/services/redash/types'
import type { ChatToolRequestOf } from './frames'
import { NOT_AVAILABLE } from './library-results'
import { toModelParameter } from './query-parameters'
import type { RedashTransport } from './transport'
import { failedResult, type ChatToolResult } from './tool-results'
import {
  MAX_QUERY_PARAMETERS,
  MAX_QUERY_SQL_CHARS,
  type ChatQueryDetailResult,
  type ChatQuerySnapshot,
} from './tool-results-query'

const MAX_VISUALIZATIONS = 20
export const MAX_TAGS = 20
const MAX_TAG_CHARS = 64

export function noQuery(queryId: number): string {
  return `No query ${queryId}`
}

function scheduleOf(schedule: RedashSchedule | null | undefined): ChatQuerySnapshot['schedule'] {
  if (!schedule || !schedule.interval) return null
  return {
    interval: schedule.interval,
    time: schedule.time ?? null,
    dayOfWeek: schedule.day_of_week == null ? null : String(schedule.day_of_week),
    until: schedule.until ?? null,
  }
}

export function snapshotOf(raw: RedashQuery): ChatQuerySnapshot {
  const parameters = (raw.options?.parameters ?? []) as unknown as Record<string, unknown>[]
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? null,
    sql: raw.query,
    dataSourceId: raw.data_source_id,
    parameters: parameters.map(toModelParameter),
    tags: (raw.tags ?? []).slice(0, MAX_TAGS),
    schedule: scheduleOf(raw.schedule),
    isDraft: raw.is_draft ?? false,
    updatedAt: raw.updated_at,
  }
}

export const TAG_TOO_LONG = 'This query has a tag longer than chat can carry; open it on the query page.'
export const NO_DATA_SOURCE = 'This query has no data source; it cannot be opened or edited from chat.'

export function unreadable(raw: RedashQuery): string | null {
  if (raw.data_source_id == null) return NO_DATA_SOURCE
  if ((raw.tags ?? []).some((tag) => tag.length > MAX_TAG_CHARS)) return TAG_TOO_LONG
  if (raw.query.length > MAX_QUERY_SQL_CHARS) return 'This query is too long for chat to read whole.'
  if ((raw.options?.parameters ?? []).length > MAX_QUERY_PARAMETERS) {
    return `This query has more than ${MAX_QUERY_PARAMETERS} parameters, which is more than chat can carry.`
  }
  return null
}

export async function fetchQuery(
  transport: RedashTransport,
  queryId: number,
  signal?: AbortSignal
): Promise<RedashQuery | null> {
  try {
    const raw = await transport.get<RedashQuery>(`queries/${queryId}`, undefined, signal)
    return raw.is_archived ? null : raw
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export async function runOpenQuery(
  request: ChatToolRequestOf<'open_query'>,
  transport: RedashTransport,
  signal: AbortSignal
): Promise<ChatToolResult> {
  const { queryId } = request.args
  try {
    const raw = await fetchQuery(transport, queryId, signal)
    if (!raw) return failedResult('query_detail', noQuery(queryId))
    const problem = unreadable(raw)
    if (problem) return failedResult('query_detail', problem)
    const result: ChatQueryDetailResult = {
      kind: 'query_detail',
      ok: true,
      query: {
        ...snapshotOf(raw),
        canEdit: raw.can_edit ?? false,
        visualizations: (raw.visualizations ?? [])
          .slice(0, MAX_VISUALIZATIONS)
          .map((one) => ({ id: one.id, name: one.name, type: one.type })),
      },
    }
    return result
  } catch (error) {
    if (signal.aborted) throw error
    if (error instanceof ApiError && error.status === 403) return failedResult('query_detail', NOT_AVAILABLE)
    return failedResult('query_detail', readQueryError(error).message)
  }
}
