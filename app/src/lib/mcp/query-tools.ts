// The tools that read and run saved queries.

import { callRedash, type McpCredential } from '@/lib/mcp/redash-caller'
import { requireNumber } from '@/lib/mcp/tool-args'
import { clampPageSize } from '@/lib/mcp/tool-schemas'
import type {
  Paginated,
  RedashExecution,
  RedashJob,
  RedashQuery,
  RedashResultBody,
} from '@/lib/mcp/redash-types'

export async function listQueries(
  args: Record<string, unknown>,
  credential: McpCredential,
  signal?: AbortSignal
) {
  const params = new URLSearchParams({ page_size: String(clampPageSize(args.page_size)) })
  if (typeof args.search === 'string' && args.search.trim()) params.set('q', args.search.trim())

  const page = await callRedash<Paginated<RedashQuery>>(`/api/queries?${params}`, credential, {
    signal,
  })
  return {
    count: page.count ?? page.results?.length ?? 0,
    queries: (page.results ?? []).map((query) => ({
      id: query.id,
      name: query.name,
      description: query.description,
      scheduled: Boolean(query.schedule?.interval),
      updated_at: query.updated_at,
    })),
  }
}

export async function getQuery(
  args: Record<string, unknown>,
  credential: McpCredential,
  signal?: AbortSignal
) {
  const id = requireNumber(args, 'query_id')
  const query = await callRedash<RedashQuery>(`/api/queries/${id}`, credential, { signal })
  return {
    id: query.id,
    name: query.name,
    description: query.description,
    data_source_id: query.data_source_id,
    // Absent when the caller lacks view_source; that is Redash's decision to
    // make, and reporting it plainly beats an empty string that reads as "this
    // query has no SQL".
    sql: query.query ?? '(not visible to this credential)',
    parameters: query.options?.parameters ?? [],
  }
}

// A saved query can return a million rows. The whole result would otherwise be
// serialised into one JSON-RPC response for a model that cannot read it anyway.
export const MAX_RESULT_ROWS = 1000

const JOB_STATUS_FINISHED = 3
const JOB_STATUS_FAILED = 4
const POLL_INTERVAL_MS = 500
export const POLL_TIMEOUT_MS = 30_000

export interface RunQueryClock {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export async function runQuery(
  args: Record<string, unknown>,
  credential: McpCredential,
  clock: RunQueryClock = {},
  signal?: AbortSignal
) {
  const id = requireNumber(args, 'query_id')
  const now = clock.now ?? (() => Date.now())
  const sleep =
    clock.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  const body: Record<string, unknown> = {}
  if (typeof args.parameters === 'object' && args.parameters !== null) {
    body.parameters = args.parameters
  }
  if (typeof args.max_age === 'number') body.max_age = args.max_age

  const execution = await callRedash<RedashExecution>(`/api/queries/${id}/results`, credential, {
    method: 'POST',
    body,
    signal,
  })

  // A cache hit comes back finished, and is the common case: this endpoint asks
  // for whatever the instance already has unless the caller sets max_age.
  const result = execution.query_result
    ? execution.query_result
    : await awaitJob(execution.job, credential, { now, sleep }, signal)

  // A saved query can return a million rows, and the whole result would
  // otherwise be serialised into one JSON-RPC response and handed to a model
  // that cannot read it anyway. The cut is reported rather than silent, so the
  // caller knows the answer is partial.
  const rows = result.data.rows.slice(0, MAX_RESULT_ROWS)
  const truncated = result.data.rows.length > rows.length

  return {
    query_id: id,
    retrieved_at: result.retrieved_at,
    runtime_seconds: result.runtime,
    columns: result.data.columns,
    row_count: rows.length,
    total_row_count: result.data.rows.length,
    ...(truncated
      ? {
          note: `Truncated to the first ${MAX_RESULT_ROWS} of ${result.data.rows.length} rows. Add a LIMIT or an aggregate to the query to see the rest.`,
        }
      : {}),
    rows,
  }
}

/**
 * Poll one job to completion, then fetch the result it points at.
 *
 * Redash's job endpoint reports status and, when finished, a query_result_id;
 * the rows live behind a second call. One deadline covers the whole wait rather
 * than each poll, so a query that keeps answering "still running" cannot hold
 * the request open indefinitely.
 */
async function awaitJob(
  job: RedashJob | undefined,
  credential: McpCredential,
  clock: { now: () => number; sleep: (ms: number) => Promise<void> },
  signal?: AbortSignal
): Promise<RedashResultBody> {
  if (!job) throw new Error('The query service returned neither a result nor a job for that query.')

  const deadline = clock.now() + POLL_TIMEOUT_MS
  let current = job

  while (current.status !== JOB_STATUS_FINISHED) {
    if (current.status === JOB_STATUS_FAILED || current.error) {
      throw new Error(current.error || 'The query failed to run.')
    }
    if (clock.now() >= deadline) {
      throw new Error(
        `The query was still running after ${POLL_TIMEOUT_MS / 1000}s. Run it in the app, or narrow it.`
      )
    }
    if (signal?.aborted) throw new Error('The client hung up before the query finished.')
    await clock.sleep(POLL_INTERVAL_MS)
    const polled = await callRedash<{ job?: RedashJob }>(`/api/jobs/${current.id}`, credential, {
      signal,
    })
    if (!polled.job) throw new Error('The query service stopped reporting on that job.')
    current = polled.job
  }

  if (current.error) throw new Error(current.error)
  if (!current.query_result_id) {
    throw new Error('The query finished but the query service reported no result to read.')
  }
  const body = await callRedash<{ query_result?: RedashResultBody }>(
    `/api/query_results/${current.query_result_id}`,
    credential,
    { signal }
  )
  if (!body.query_result) throw new Error('The query service returned an empty result body.')
  return body.query_result
}
