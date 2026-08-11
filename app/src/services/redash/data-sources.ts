/**
 * Data sources against the real Redash backend.
 *
 * The list endpoint omits `options` — the detail view needs GET /:id.
 * GET /:id/schema may return {schema} directly or {job} to poll (refresh, or
 * a refresh already in progress); the finished job carries the schema in its
 * `result` field. Column shape varies by query runner: string[] or
 * {name, type}[] — normalize to the typed shape the schema browser expects.
 */

import { redashApi, ApiError } from '@/services/api-client'
import type { SchemaTable } from '@/lib/mock-data'
import { JOB_STATUS, type RedashJob, type RedashSchemaTableRaw } from './types'

export interface RedashDataSource {
  id: number
  name: string
  type: string
  syntax?: string
  paused?: number
  pause_reason?: string | null
  supports_auto_limit?: boolean
  view_only?: boolean
  options?: Record<string, unknown>
  groups?: Record<string, boolean>
  queue_name?: string
  scheduled_queue_name?: string
  created_at?: string
}

export interface RedashDataSourceType {
  type: string
  name: string
  configuration_schema: Record<string, unknown>
}

export function listDataSources() {
  return redashApi.get<RedashDataSource[]>('data_sources')
}

export async function getDataSource(id: number): Promise<RedashDataSource | null> {
  try {
    return await redashApi.get<RedashDataSource>(`data_sources/${id}`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

export function listTypes() {
  return redashApi.get<RedashDataSourceType[]>('data_sources/types')
}

export function createDataSource(data: {
  name: string
  type: string
  options: Record<string, unknown>
}): Promise<RedashDataSource> {
  return redashApi.post<RedashDataSource>('data_sources', data)
}

export function updateDataSource(
  id: number,
  data: { name?: string; type?: string; options?: Record<string, unknown> }
): Promise<RedashDataSource> {
  return redashApi.post<RedashDataSource>(`data_sources/${id}`, data)
}

export async function deleteDataSource(id: number): Promise<void> {
  await redashApi.delete(`data_sources/${id}`)
}

/**
 * Stops every query and alert behind this source at once, with a reason Redash
 * shows wherever the source appears. Admin only, like the rest of this file's
 * writes.
 */
export function pauseDataSource(id: number, reason?: string): Promise<RedashDataSource> {
  // An empty box is no reason at all, not an empty-string one, which would
  // render as a blank explanation next to the paused source.
  const body = reason?.trim() ? { reason: reason.trim() } : {}
  return redashApi.post<RedashDataSource>(`data_sources/${id}/pause`, body)
}

/** Resuming is a DELETE of the pause, not a flag on the source. */
export function resumeDataSource(id: number): Promise<RedashDataSource> {
  return redashApi.delete<RedashDataSource>(`data_sources/${id}/pause`)
}

export async function testConnection(
  id: number
): Promise<{ ok: boolean; message?: string }> {
  try {
    const result = await redashApi.post<{ ok?: boolean; message?: string }>(
      `data_sources/${id}/test`
    )
    return { ok: result.ok !== false, message: result.message }
  } catch (err) {
    if (err instanceof ApiError) {
      return { ok: false, message: err.message || 'Connection test failed' }
    }
    return { ok: false, message: 'Connection test failed' }
  }
}

function mapSchemaTable(raw: RedashSchemaTableRaw): SchemaTable {
  return {
    name: raw.name,
    columns: (raw.columns || []).map((col) =>
      typeof col === 'string' ? { name: col, type: '' } : { name: col.name, type: col.type || '' }
    ),
  }
}

const SCHEMA_POLL_INTERVAL = 1000
const SCHEMA_MAX_POLL_TIME = 30_000

/**
 * Rejects rather than resolving when the caller aborts mid-wait, so a cancelled
 * poll does not sit out the rest of the interval before noticing. Mirrors the
 * helper of the same name in jobs.ts, which is private to that module.
 */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function getSchema(
  id: number,
  refresh = false,
  signal?: AbortSignal
): Promise<SchemaTable[]> {
  const res = await redashApi.get<{
    schema?: RedashSchemaTableRaw[]
    job?: RedashJob
  }>(`data_sources/${id}/schema`, {
    params: refresh ? { refresh: true } : undefined,
    signal,
  })

  if (res.job) return pollSchemaJob(res.job.id, signal)
  return (res.schema || []).map(mapSchemaTable)
}

async function pollSchemaJob(jobId: string, signal?: AbortSignal): Promise<SchemaTable[]> {
  const start = Date.now()
  while (Date.now() - start < SCHEMA_MAX_POLL_TIME) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const { job } = await redashApi.get<{
      job: RedashJob & { result?: RedashSchemaTableRaw[] }
    }>(`jobs/${jobId}`, { signal })

    if (job.status === JOB_STATUS.SUCCESS) {
      return Array.isArray(job.result) ? job.result.map(mapSchemaTable) : []
    }
    if (job.status === JOB_STATUS.FAILURE) {
      throw new Error(job.error || 'Schema refresh failed')
    }
    if (job.status === JOB_STATUS.CANCELLED) {
      throw new Error('Schema refresh cancelled')
    }
    await abortableDelay(SCHEMA_POLL_INTERVAL, signal)
  }
  // Running past the ceiling is a refresh that is still working, not a source
  // with no tables. Resolving empty here made the two indistinguishable, and
  // the schema browser rendered "no tables" for a backend that was merely slow.
  throw new Error('Schema refresh timed out')
}
