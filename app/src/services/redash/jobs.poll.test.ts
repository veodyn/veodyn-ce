// Where a finished job hides its result id, and what the caller is told when
// there is none.
//
// Redash moved the field across versions: older instances answer `result_id`,
// newer ones `query_result_id`, and some serializers send a bare `result`. The
// fallback chain in pollJob is the only thing holding those together, and if it
// picks the wrong one a query that ran perfectly well reports "no result ID" or,
// worse, resolves with undefined and the results pane renders empty.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cancelJob, pollJob } from './jobs'
import { JOB_STATUS } from './types'

const get = vi.fn()
const del = vi.fn()

vi.mock('@/services/api-client', () => ({
  redashApi: {
    get: (path: string, options?: unknown) => get(path, options),
    delete: (path: string) => del(path),
    post: vi.fn(),
  },
  ApiError: class extends Error {},
}))

/** Mirrors the module constants, which are private to jobs.ts. */
const POLL_INTERVAL = 1000
const MAX_POLL_TIME = 300_000

function job(fields: Record<string, unknown>) {
  return { job: { id: 'j-1', error: '', ...fields } }
}

beforeEach(() => {
  vi.useFakeTimers()
  get.mockReset()
  del.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('pollJob reads the finished job', () => {
  it('polls the job by id', async () => {
    get.mockResolvedValue(job({ status: JOB_STATUS.SUCCESS, query_result_id: 7 }))

    await pollJob('abc-123')

    expect(get).toHaveBeenCalledWith('jobs/abc-123', undefined)
  })

  it('prefers query_result_id', async () => {
    get.mockResolvedValue(job({ status: JOB_STATUS.SUCCESS, query_result_id: 7, result_id: 99 }))

    await expect(pollJob('j-1')).resolves.toBe(7)
  })

  it('falls back to result_id on an instance that sends only that', async () => {
    get.mockResolvedValue(job({ status: JOB_STATUS.SUCCESS, result_id: 42 }))

    await expect(pollJob('j-1')).resolves.toBe(42)
  })

  it('falls back again to a bare result field', async () => {
    get.mockResolvedValue(job({ status: JOB_STATUS.SUCCESS, result: 13 }))

    await expect(pollJob('j-1')).resolves.toBe(13)
  })

  // Result id 0 is a real id. `??` is what keeps it, where `||` would skip past
  // it to the next candidate and end at "no result ID returned".
  it('accepts a result id of zero', async () => {
    get.mockResolvedValue(job({ status: JOB_STATUS.SUCCESS, query_result_id: 0 }))

    await expect(pollJob('j-1')).resolves.toBe(0)
  })

  it('reports a finished job that carries no result id', async () => {
    get.mockResolvedValue(job({ status: JOB_STATUS.SUCCESS }))

    await expect(pollJob('j-1')).rejects.toThrow('Job finished but no result ID returned')
  })

  // A null query_result_id is what Redash sends while the row is still being
  // written; it is not a result id and must not be returned as one.
  it('does not return a null query_result_id', async () => {
    get.mockResolvedValue(job({ status: JOB_STATUS.SUCCESS, query_result_id: null, result_id: 5 }))

    await expect(pollJob('j-1')).resolves.toBe(5)
  })
})

describe('pollJob on a job that did not succeed', () => {
  it('throws the error the backend gave', async () => {
    get.mockResolvedValue(job({ status: JOB_STATUS.FAILURE, error: 'Table does not exist' }))

    await expect(pollJob('j-1')).rejects.toThrow('Table does not exist')
  })

  it('falls back to a generic message when the failure has no error text', async () => {
    get.mockResolvedValue(job({ status: JOB_STATUS.FAILURE, error: '' }))

    await expect(pollJob('j-1')).rejects.toThrow('Query execution failed')
  })

  it('distinguishes a cancelled job from a failed one', async () => {
    get.mockResolvedValue(job({ status: JOB_STATUS.CANCELLED, error: '' }))

    await expect(pollJob('j-1')).rejects.toThrow('Query execution was cancelled')
  })
})

describe('pollJob keeps polling while the job runs', () => {
  it('waits the poll interval and asks again', async () => {
    get
      .mockResolvedValueOnce(job({ status: JOB_STATUS.PENDING }))
      .mockResolvedValueOnce(job({ status: JOB_STATUS.STARTED }))
      .mockResolvedValueOnce(job({ status: JOB_STATUS.SUCCESS, query_result_id: 9 }))

    const result = pollJob('j-1')
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL * 2)

    await expect(result).resolves.toBe(9)
    expect(get).toHaveBeenCalledTimes(3)
  })

  // 6 DEFERRED and 7 SCHEDULED exist on newer instances. Anything the switch
  // does not name has to read as still-running, not as a silent success.
  it('treats an unknown status as still running rather than finishing', async () => {
    get
      .mockResolvedValueOnce(job({ status: 7 }))
      .mockResolvedValueOnce(job({ status: JOB_STATUS.SUCCESS, query_result_id: 4 }))

    const result = pollJob('j-1')
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL)

    await expect(result).resolves.toBe(4)
  })

  it('gives up once the job has run past the poll ceiling', async () => {
    get.mockImplementation(async () => {
      // Jump the clock the way a genuinely long run would, without making the
      // test walk 300 real poll iterations.
      vi.setSystemTime(Date.now() + MAX_POLL_TIME + POLL_INTERVAL)
      return job({ status: JOB_STATUS.PENDING })
    })

    // The assertion is attached before the clock moves, so the rejection never
    // passes through a tick with no handler on it.
    const rejects = expect(pollJob('j-1')).rejects.toThrow('Query execution timed out')
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL)

    await rejects
  })
})

describe('pollJob honours an abort signal', () => {
  it('refuses to poll at all when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(pollJob('j-1', controller.signal)).rejects.toThrow('Aborted')
    expect(get).not.toHaveBeenCalled()
  })

  it('stops mid-wait when the caller aborts', async () => {
    get.mockResolvedValue(job({ status: JOB_STATUS.PENDING }))
    const controller = new AbortController()

    const rejects = expect(pollJob('j-1', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    // Let the first poll land and the interval timer be scheduled.
    await vi.advanceTimersByTimeAsync(0)
    const callsBeforeAbort = get.mock.calls.length
    controller.abort()

    await rejects
    // And it does not sneak in one more poll after the abort.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL * 3)
    expect(get).toHaveBeenCalledTimes(callsBeforeAbort)
  })

  it('aborts with a DOMException so a caller can tell it from a real failure', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(pollJob('j-1', controller.signal)).rejects.toBeInstanceOf(DOMException)
  })
})

describe('cancelJob', () => {
  it('deletes the job rather than posting a cancel flag', async () => {
    del.mockResolvedValue(undefined)

    await cancelJob('abc-123')

    expect(del).toHaveBeenCalledWith('jobs/abc-123')
  })
})
