import { isSchemaNotSupported, schemaJobMessage, type SchemaJobError } from '@/services/redash/schema-job'
import { abortableDelay } from '@/lib/abortable-delay'
import type { MockDashboard, MockQuery, SchemaTable } from '@/lib/mock-data'
import type { TagSuggestion } from '@/lib/tags'
import { ApiError } from '@/services/api-client'
import type { RedashDataSource } from '@/services/redash/data-sources'
import { normalizeDashboard } from '@/services/redash/normalize-dashboard'
import { normalizeQuery } from '@/services/redash/normalize-query'
import { mapSchemaTable } from '@/services/redash/normalize-schema'
import {
  JOB_STATUS,
  type RedashDashboard,
  type RedashExecutionResponse,
  type RedashJob,
  type RedashPaginatedResponse,
  type RedashQuery,
  type RedashQueryResult,
  type RedashSchemaTableRaw,
  type RedashVisualization,
} from '@/services/redash/types'
import { readVocabulary } from '@/services/tags/client'
import type { RedashTransport } from './transport'

const JOB_POLL_INTERVAL_MS = 1000
const JOB_MAX_POLL_MS = 300_000
const SCHEMA_MAX_POLL_MS = 30_000
const DEFAULT_PAGE_SIZE = 25

export type NodeTagScope = 'queries' | 'dashboards'

export interface ExecuteOptions {
  parameters?: Record<string, unknown>
  maxAge?: number
  applyAutoLimit?: boolean
  maxResultBytes?: number
  signal?: AbortSignal
  onJob?: (jobId: string) => void
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

async function orNull<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

export function listDataSources(transport: RedashTransport, signal?: AbortSignal): Promise<RedashDataSource[]> {
  return transport.get<RedashDataSource[]>('data_sources', undefined, signal)
}

export function getDataSource(
  transport: RedashTransport,
  id: number,
  signal?: AbortSignal
): Promise<RedashDataSource | null> {
  return orNull(transport.get<RedashDataSource>(`data_sources/${id}`, undefined, signal))
}

type SchemaJob = Omit<RedashJob, 'error'> & { error?: SchemaJobError; result?: RedashSchemaTableRaw[] }

async function pollSchemaJob(transport: RedashTransport, jobId: string, signal?: AbortSignal): Promise<SchemaTable[]> {
  const start = Date.now()
  while (Date.now() - start < SCHEMA_MAX_POLL_MS) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const { job } = await transport.get<{ job: SchemaJob }>(`jobs/${jobId}`, undefined, signal)
    if (job.status === JOB_STATUS.SUCCESS) {
      return Array.isArray(job.result) ? job.result.map(mapSchemaTable) : []
    }
    if (job.status === JOB_STATUS.FAILURE) {
      if (isSchemaNotSupported(job.error)) return []
      throw new Error(schemaJobMessage(job.error) || 'Schema refresh failed')
    }
    if (job.status === JOB_STATUS.CANCELLED) throw new Error('Schema refresh cancelled')
    await abortableDelay(JOB_POLL_INTERVAL_MS, signal)
  }
  throw new Error('Schema refresh timed out')
}

export async function getSchema(
  transport: RedashTransport,
  id: number,
  refresh = false,
  signal?: AbortSignal
): Promise<SchemaTable[]> {
  const res = await transport.get<{ schema?: RedashSchemaTableRaw[]; job?: RedashJob }>(
    `data_sources/${id}/schema`,
    refresh ? { refresh: true } : undefined,
    signal
  )
  if (res.job) return pollSchemaJob(transport, res.job.id, signal)
  return (res.schema || []).map(mapSchemaTable)
}

function listParams(search: string, tags: string[] | undefined, pageSize: number | undefined) {
  return {
    page: 1,
    page_size: pageSize ?? DEFAULT_PAGE_SIZE,
    q: search || undefined,
    tags: tags?.length ? tags : undefined,
  }
}

export async function searchQueries(
  transport: RedashTransport,
  q: string,
  opts?: { signal?: AbortSignal; tags?: string[]; order?: string; archived?: boolean }
): Promise<RedashPaginatedResponse<MockQuery>> {
  const raw = await transport.get<RedashPaginatedResponse<RedashQuery>>(
    opts?.archived ? 'queries/archive' : 'queries',
    { ...listParams(q, opts?.tags, undefined), order: opts?.order },
    opts?.signal
  )
  return { ...raw, results: raw.results.map(normalizeQuery) }
}

export async function getQuery(
  transport: RedashTransport,
  id: number,
  signal?: AbortSignal
): Promise<MockQuery | null> {
  const raw = await orNull(transport.get<RedashQuery>(`queries/${id}`, undefined, signal))
  return raw ? normalizeQuery(raw) : null
}

export async function searchDashboards(
  transport: RedashTransport,
  q: string,
  opts?: { signal?: AbortSignal; tags?: string[]; pageSize?: number; archived?: boolean }
): Promise<RedashPaginatedResponse<MockDashboard>> {
  const raw = await transport.get<RedashPaginatedResponse<RedashDashboard>>(
    opts?.archived ? 'dashboards/archive' : 'dashboards',
    listParams(q, opts?.tags, opts?.pageSize),
    opts?.signal
  )
  return { ...raw, results: raw.results.map(normalizeDashboard) }
}

export async function getDashboard(
  transport: RedashTransport,
  id: number,
  signal?: AbortSignal
): Promise<MockDashboard | null> {
  const raw = await orNull(transport.get<RedashDashboard>(`dashboards/${id}`, undefined, signal))
  return raw ? normalizeDashboard(raw) : null
}

export async function getQueryResult(
  transport: RedashTransport,
  resultId: number,
  signal?: AbortSignal,
  maxBytes?: number
): Promise<RedashQueryResult> {
  const limits = maxBytes === undefined ? undefined : { maxBytes }
  const res = await transport.get<{ query_result: RedashQueryResult }>(
    `query_results/${resultId}`,
    undefined,
    signal,
    limits
  )
  return res.query_result
}

export async function tagVocabulary(
  transport: RedashTransport,
  scope: NodeTagScope,
  signal?: AbortSignal
): Promise<TagSuggestion[]> {
  return readVocabulary(await transport.get<unknown>(`${scope}/tags`, undefined, signal))
}

async function pollJob(transport: RedashTransport, jobId: string, signal?: AbortSignal): Promise<number> {
  const start = Date.now()
  while (Date.now() - start < JOB_MAX_POLL_MS) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const { job } = await transport.get<{ job: RedashJob }>(`jobs/${jobId}`, undefined, signal)
    switch (job.status) {
      case JOB_STATUS.SUCCESS: {
        const resultId = job.query_result_id ?? job.result_id ?? (job as { result?: number }).result
        if (typeof resultId === 'number') return resultId
        throw new Error('Job finished but no result ID returned')
      }
      case JOB_STATUS.FAILURE:
        throw new Error(job.error || 'Query execution failed')
      case JOB_STATUS.CANCELLED:
        throw new Error('Query execution was cancelled')
      default:
        await abortableDelay(JOB_POLL_INTERVAL_MS, signal)
    }
  }
  throw new Error('Query execution timed out')
}

async function resolveExecution(
  transport: RedashTransport,
  res: RedashExecutionResponse,
  opts: ExecuteOptions
): Promise<RedashQueryResult> {
  if (res.query_result) return res.query_result
  if (res.job) {
    opts.onJob?.(res.job.id)
    const resultId = await pollJob(transport, res.job.id, opts.signal)
    return getQueryResult(transport, resultId, opts.signal, opts.maxResultBytes)
  }
  throw new Error('Unexpected response from query execution')
}

export async function executeSavedQuery(
  transport: RedashTransport,
  queryId: number,
  opts: ExecuteOptions = {}
): Promise<RedashQueryResult> {
  const body: Record<string, unknown> = {}
  if (opts.maxAge !== undefined) body.max_age = opts.maxAge
  if (opts.parameters && Object.keys(opts.parameters).length > 0) body.parameters = opts.parameters
  if (opts.applyAutoLimit !== undefined) body.apply_auto_limit = opts.applyAutoLimit
  const res = await transport.post<RedashExecutionResponse>(`queries/${queryId}/results`, body, opts.signal)
  return resolveExecution(transport, res, opts)
}

export async function executeAdhoc(
  transport: RedashTransport,
  dataSourceId: number,
  queryText: string,
  opts: ExecuteOptions = {}
): Promise<RedashQueryResult> {
  const body: Record<string, unknown> = { data_source_id: dataSourceId, query: queryText, max_age: 0 }
  if (opts.parameters && Object.keys(opts.parameters).length > 0) body.parameters = opts.parameters
  if (opts.applyAutoLimit !== undefined) body.apply_auto_limit = opts.applyAutoLimit
  const res = await transport.post<RedashExecutionResponse>('query_results', body, opts.signal)
  return resolveExecution(transport, res, opts)
}

export interface VisualizationCreate {
  query_id: number
  type: string
  name: string
  options: Record<string, unknown>
  idempotency_key?: string
}

export interface VisualizationChanges {
  type?: string
  name?: string
  options?: Record<string, unknown>
}

export function createVisualization(
  transport: RedashTransport,
  data: VisualizationCreate,
  signal?: AbortSignal
): Promise<RedashVisualization> {
  return transport.post<RedashVisualization>('visualizations', data, signal)
}

export function updateVisualization(
  transport: RedashTransport,
  id: number,
  changes: VisualizationChanges,
  expectedUpdatedAt?: string,
  signal?: AbortSignal
): Promise<RedashVisualization> {
  const body = expectedUpdatedAt === undefined ? changes : { ...changes, expected_updated_at: expectedUpdatedAt }
  return transport.post<RedashVisualization>(`visualizations/${id}`, body, signal)
}

export async function deleteVisualization(
  transport: RedashTransport,
  id: number,
  expectedUpdatedAt?: string,
  signal?: AbortSignal
): Promise<void> {
  const params = expectedUpdatedAt === undefined ? undefined : { expected_updated_at: expectedUpdatedAt }
  await transport.del<void>(`visualizations/${id}`, params, signal)
}
