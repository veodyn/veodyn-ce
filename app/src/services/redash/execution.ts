/**
 * Query execution against the real Redash backend.
 *
 * max_age semantics (important): omitted means "any cached result is fine";
 * 0 forces a fresh execution. Never default to 0 outside explicit
 * execute/refresh actions or dashboards will hammer the backend.
 */

import { redashApi } from '@/services/api-client'
import { pollJob } from './jobs'
import type { RedashExecutionResponse, RedashQueryResult } from './types'

export interface ExecuteOptions {
  parameters?: Record<string, unknown>
  /** Omit to accept any cached result; 0 to force fresh execution */
  maxAge?: number
  applyAutoLimit?: boolean
  signal?: AbortSignal
  /** Reports the job id as soon as execution is queued (used for cancel) */
  onJob?: (jobId: string) => void
}

async function resolveExecution(
  res: RedashExecutionResponse,
  opts: ExecuteOptions
): Promise<RedashQueryResult> {
  if (res.query_result) return res.query_result
  if (res.job) {
    opts.onJob?.(res.job.id)
    const resultId = await pollJob(res.job.id, opts.signal)
    return getResult(resultId, opts.signal)
  }
  throw new Error('Unexpected response from query execution')
}

/** Execute a saved query (POST /api/queries/:id/results). */
export async function executeSavedQuery(
  queryId: number,
  opts: ExecuteOptions = {}
): Promise<RedashQueryResult> {
  const body: Record<string, unknown> = {}
  if (opts.maxAge !== undefined) body.max_age = opts.maxAge
  if (opts.parameters && Object.keys(opts.parameters).length > 0) {
    body.parameters = opts.parameters
  }
  if (opts.applyAutoLimit !== undefined) body.apply_auto_limit = opts.applyAutoLimit

  const res = await redashApi.post<RedashExecutionResponse>(
    `queries/${queryId}/results`,
    body,
    { signal: opts.signal }
  )
  return resolveExecution(res, opts)
}

/** Execute arbitrary SQL (POST /api/query_results) — what the editor runs. */
export async function executeAdhoc(
  dataSourceId: number,
  queryText: string,
  opts: ExecuteOptions = {}
): Promise<RedashQueryResult> {
  const body: Record<string, unknown> = {
    data_source_id: dataSourceId,
    query: queryText,
    max_age: 0,
  }
  if (opts.parameters && Object.keys(opts.parameters).length > 0) {
    body.parameters = opts.parameters
  }
  if (opts.applyAutoLimit !== undefined) body.apply_auto_limit = opts.applyAutoLimit

  const res = await redashApi.post<RedashExecutionResponse>('query_results', body, {
    signal: opts.signal,
  })
  return resolveExecution(res, opts)
}

/**
 * Fetch a stored result by id (unwraps the {query_result} envelope).
 *
 * The signal is threaded here and through the POSTs above because a caller that
 * cancels has to reach every hop of an execution, not just the polling loop in
 * the middle of it. Without it, aborting during the initial POST or the final
 * fetch left a request in flight whose response nobody was waiting for.
 */
export async function getResult(
  resultId: number,
  signal?: AbortSignal
): Promise<RedashQueryResult> {
  const res = await redashApi.get<{ query_result: RedashQueryResult }>(
    `query_results/${resultId}`,
    { signal }
  )
  return res.query_result
}

/** Format SQL via Redash (POST /api/queries/format). */
export async function formatQuery(queryText: string): Promise<string> {
  const res = await redashApi.post<{ query: string }>('queries/format', {
    query: queryText,
  })
  return res.query
}
