import { readQueryError } from '@/lib/query-error'
import { ApiError } from '@/services/api-client'
import type { RedashDataSource } from '@/services/redash/data-sources'
import type { ChatToolRequestOf } from './frames'
import { NOT_AVAILABLE } from './library-results'
import { fetchQuery, MAX_TAGS, noQuery, snapshotOf, unreadable } from './query-detail'
import type { QueryChanges } from './query-changes'
import type { RedashTransport } from './transport'
import { failedResult, type ChatToolResult } from './tool-results'
import type { ChatQueryEditResult, ChatQuerySnapshot } from './tool-results-query'

export { applyQueryEdit, type ApplyOutcome, type EditDraft } from './query-edit-apply'

export const CANNOT_EDIT =
  'You cannot edit this query: only its owner, an admin or someone it is shared with can.'
export const DRAFTS_OFF = 'Drafts are not turned on for this instance, so isDraft cannot be changed.'
export const SYNTAX_MISMATCH = 'The new data source speaks a different query language than the current one.'
export const TOO_MANY_TAGS =
  'This query has more tags than chat can edit safely; change its tags on the query page.'
export const FORMAT_SQL_ONLY = 'Formatting only works on SQL data sources.'

export interface QueryEditFeatures {
  queryDrafts: boolean
}

type Snapshot = Record<string, unknown>

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((one, i) => sameValue(one, b[i]))
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    return [...keys].every((key) => sameValue(left[key] ?? null, right[key] ?? null))
  }
  return false
}

function normalized(field: string, value: unknown): unknown {
  if (field === 'description') return value ?? ''
  if (field === 'schedule') {
    const schedule = value as { interval?: number } | null
    return !schedule || !schedule.interval ? null : schedule
  }
  return value
}

export function diffQuery(snapshot: ChatQuerySnapshot, changes: QueryChanges): QueryChanges {
  const before = snapshot as unknown as Snapshot
  const changed: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(changes)) {
    if (!sameValue(normalized(field, before[field]), normalized(field, value))) changed[field] = value
  }
  return changed as QueryChanges
}

function failed(error: string): ChatToolResult {
  return failedResult('query_edit', error)
}

async function syntaxOf(
  transport: RedashTransport,
  dataSourceId: number,
  signal: AbortSignal
): Promise<string | null> {
  try {
    const source = await transport.get<RedashDataSource>(`data_sources/${dataSourceId}`, undefined, signal)
    return source.syntax ?? 'sql'
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) return null
    throw error
  }
}

async function formatSql(transport: RedashTransport, sql: string, signal: AbortSignal): Promise<string> {
  const formatted = await transport.post<{ query: string }>('queries/format', { query: sql }, signal)
  return formatted.query
}

export async function resolveQueryEdit(
  request: ChatToolRequestOf<'update_query'>,
  transport: RedashTransport,
  signal: AbortSignal,
  features: QueryEditFeatures = { queryDrafts: false }
): Promise<ChatToolResult> {
  const { queryId, changes, format } = request.args
  try {
    const raw = await fetchQuery(transport, queryId, signal)
    if (!raw) return failed(noQuery(queryId))
    if (!raw.can_edit) return failed(CANNOT_EDIT)
    const problem = unreadable(raw)
    if (problem) return failed(problem)
    if (changes.isDraft !== undefined && !features.queryDrafts) return failed(DRAFTS_OFF)
    if (changes.tags !== undefined && (raw.tags ?? []).length > MAX_TAGS) return failed(TOO_MANY_TAGS)

    const snapshot = snapshotOf(raw)
    const proposed: QueryChanges = { ...changes }
    const targetSourceId = changes.dataSourceId ?? snapshot.dataSourceId

    if (changes.dataSourceId !== undefined && changes.dataSourceId !== snapshot.dataSourceId) {
      const [current, next] = await Promise.all([
        syntaxOf(transport, snapshot.dataSourceId, signal),
        syntaxOf(transport, changes.dataSourceId, signal),
      ])
      if (next === null) return failed(NOT_AVAILABLE)
      if (current !== null && current !== next) return failed(SYNTAX_MISMATCH)
    }

    if (format === true) {
      if ((await syntaxOf(transport, targetSourceId, signal)) !== 'sql') return failed(FORMAT_SQL_ONLY)
      proposed.sql = await formatSql(transport, changes.sql ?? snapshot.sql, signal)
    }

    const result: ChatQueryEditResult = {
      kind: 'query_edit',
      ok: true,
      queryId,
      snapshot,
      changes: diffQuery(snapshot, proposed),
    }
    return result
  } catch (error) {
    if (signal.aborted) throw error
    if (error instanceof ApiError && error.status === 403) return failed(NOT_AVAILABLE)
    return failed(readQueryError(error).message)
  }
}
