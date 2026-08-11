/**
 * Redash async job polling.
 *
 * Query execution and schema refresh return a job; poll GET /api/jobs/:id
 * until it finishes. Job IDs are UUID strings. Statuses:
 *   1 QUEUED, 2 STARTED, 3 FINISHED, 4 FAILED, 5 CANCELLED
 *   (6 DEFERRED, 7 SCHEDULED on newer instances — treated as still-running)
 */

import { redashApi } from '@/services/api-client'
import { JOB_STATUS, type RedashJob } from './types'

const POLL_INTERVAL = 1000
const MAX_POLL_TIME = 300_000 // 5 minutes

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

/**
 * Poll a job until it finishes; resolves with the query_result id.
 */
export async function pollJob(jobId: string, signal?: AbortSignal): Promise<number> {
  const start = Date.now()

  while (Date.now() - start < MAX_POLL_TIME) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const { job } = await redashApi.get<{ job: RedashJob }>(`jobs/${jobId}`)

    switch (job.status) {
      case JOB_STATUS.SUCCESS: {
        // Field name varies across Redash versions
        const resultId =
          job.query_result_id ?? job.result_id ?? (job as { result?: number }).result
        if (typeof resultId === 'number') return resultId
        throw new Error('Job finished but no result ID returned')
      }
      case JOB_STATUS.FAILURE:
        throw new Error(job.error || 'Query execution failed')
      case JOB_STATUS.CANCELLED:
        throw new Error('Query execution was cancelled')
      default:
        await abortableDelay(POLL_INTERVAL, signal)
    }
  }

  throw new Error('Query execution timed out')
}

export async function cancelJob(jobId: string): Promise<void> {
  await redashApi.delete(`jobs/${jobId}`)
}
