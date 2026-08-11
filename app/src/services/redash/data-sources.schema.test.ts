// The schema browser's column shapes, and the job it may have to wait on.
//
// Every query runner reports its columns differently: some send `["id", "ts"]`,
// some send `[{name, type}]`, and some send an object whose `type` is null. The
// schema tree renders `col.type` straight into the row, so a shape this
// normalizer does not handle shows up as "undefined" beside a real column name
// rather than as an error anyone would file.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { getSchema } from './data-sources'
import { JOB_STATUS } from './types'

const get = vi.fn()

vi.mock('@/services/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api-client')>()),
  redashApi: {
    get: (path: string, options?: unknown) => get(path, options),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

beforeEach(() => {
  vi.useFakeTimers()
  get.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getSchema request', () => {
  it('reads the schema sub-path without a refresh param by default', async () => {
    get.mockResolvedValue({ schema: [] })

    await getSchema(3)

    expect(get).toHaveBeenCalledWith('data_sources/3/schema', {
      params: undefined,
      signal: undefined,
    })
  })

  // Refresh is what makes Redash re-introspect rather than serve its cache, so
  // the "Refresh schema" button does nothing at all if the param is dropped.
  it('asks for a refresh when told to', async () => {
    get.mockResolvedValue({ schema: [] })

    await getSchema(3, true)

    expect(get).toHaveBeenCalledWith('data_sources/3/schema', {
      params: { refresh: true },
      signal: undefined,
    })
  })

  it('answers an empty list when the body carries no schema', async () => {
    get.mockResolvedValue({})

    await expect(getSchema(3)).resolves.toEqual([])
  })
})

describe('column shapes across query runners', () => {
  it('turns a bare string column into a named column with no type', async () => {
    get.mockResolvedValue({ schema: [{ name: 'events', columns: ['id', 'ts'] }] })

    await expect(getSchema(3)).resolves.toEqual([
      { name: 'events', columns: [{ name: 'id', type: '' }, { name: 'ts', type: '' }] },
    ])
  })

  it('keeps the type on an object column', async () => {
    get.mockResolvedValue({
      schema: [{ name: 'events', columns: [{ name: 'id', type: 'UInt64' }] }],
    })

    await expect(getSchema(3)).resolves.toEqual([
      { name: 'events', columns: [{ name: 'id', type: 'UInt64' }] },
    ])
  })

  // A runner that knows the column but not its type sends null, and `undefined`
  // would be rendered verbatim next to the column name.
  it('turns a null column type into an empty string', async () => {
    get.mockResolvedValue({ schema: [{ name: 'events', columns: [{ name: 'id', type: null }] }] })

    const [table] = await getSchema(3)

    expect(table.columns[0]).toEqual({ name: 'id', type: '' })
  })

  it('handles a table whose columns key is missing entirely', async () => {
    get.mockResolvedValue({ schema: [{ name: 'events' }] })

    await expect(getSchema(3)).resolves.toEqual([{ name: 'events', columns: [] }])
  })

  it('normalizes a table that mixes both column shapes', async () => {
    get.mockResolvedValue({
      schema: [{ name: 'events', columns: ['id', { name: 'ts', type: 'DateTime' }] }],
    })

    const [table] = await getSchema(3)

    expect(table.columns).toEqual([
      { name: 'id', type: '' },
      { name: 'ts', type: 'DateTime' },
    ])
  })

  it('normalizes every table, not only the first', async () => {
    get.mockResolvedValue({
      schema: [
        { name: 'a', columns: ['x'] },
        { name: 'b', columns: ['y'] },
      ],
    })

    const tables = await getSchema(3)

    expect(tables.map((t) => t.columns)).toEqual([[{ name: 'x', type: '' }], [{ name: 'y', type: '' }]])
  })
})

describe('getSchema when the backend hands back a job', () => {
  it('polls the job and normalizes the schema it carries', async () => {
    get
      .mockResolvedValueOnce({ job: { id: 'job-9', status: JOB_STATUS.PENDING, error: '' } })
      .mockResolvedValueOnce({ job: { id: 'job-9', status: JOB_STATUS.STARTED, error: '' } })
      .mockResolvedValueOnce({
        job: {
          id: 'job-9',
          status: JOB_STATUS.SUCCESS,
          error: '',
          result: [{ name: 'events', columns: ['id'] }],
        },
      })

    const schema = getSchema(3, true)
    await vi.advanceTimersByTimeAsync(2000)

    await expect(schema).resolves.toEqual([{ name: 'events', columns: [{ name: 'id', type: '' }] }])
    expect(get).toHaveBeenNthCalledWith(2, 'jobs/job-9', { signal: undefined })
  })

  it('answers empty when the finished job carries no result array', async () => {
    get.mockResolvedValueOnce({ job: { id: 'job-9', status: JOB_STATUS.PENDING, error: '' } })
    get.mockResolvedValue({ job: { id: 'job-9', status: JOB_STATUS.SUCCESS, error: '' } })

    const schema = getSchema(3, true)
    await vi.advanceTimersByTimeAsync(1000)

    await expect(schema).resolves.toEqual([])
  })

  it('surfaces the reason a schema refresh failed', async () => {
    get
      .mockResolvedValueOnce({ job: { id: 'job-9', status: JOB_STATUS.PENDING, error: '' } })
      .mockResolvedValue({
        job: { id: 'job-9', status: JOB_STATUS.FAILURE, error: 'permission denied for schema' },
      })

    const rejects = expect(getSchema(3, true)).rejects.toThrow('permission denied for schema')
    await vi.advanceTimersByTimeAsync(1000)

    await rejects
  })

  it('falls back to a generic message when the failed job has no error text', async () => {
    get
      .mockResolvedValueOnce({ job: { id: 'job-9', status: JOB_STATUS.PENDING, error: '' } })
      .mockResolvedValue({ job: { id: 'job-9', status: JOB_STATUS.FAILURE, error: '' } })

    const rejects = expect(getSchema(3, true)).rejects.toThrow('Schema refresh failed')
    await vi.advanceTimersByTimeAsync(1000)

    await rejects
  })

  it('distinguishes a cancelled refresh from a failed one', async () => {
    get
      .mockResolvedValueOnce({ job: { id: 'job-9', status: JOB_STATUS.PENDING, error: '' } })
      .mockResolvedValue({ job: { id: 'job-9', status: JOB_STATUS.CANCELLED, error: '' } })

    const rejects = expect(getSchema(3, true)).rejects.toThrow('Schema refresh cancelled')
    await vi.advanceTimersByTimeAsync(1000)

    await rejects
  })

  // A refresh still running past the ceiling used to resolve with an empty
  // array, which the schema browser renders exactly like a source that has no
  // tables. Every other way out of the loop throws, so this one has to as well,
  // and it has to say "timed out" rather than anything about the schema being
  // empty.
  it('throws when the job is still running past the wait ceiling', async () => {
    get.mockImplementation(async (path: string) => {
      if (path.startsWith('jobs/')) {
        // Jump the clock the way a genuinely slow refresh would, without making
        // the test walk 30 real poll iterations.
        vi.setSystemTime(Date.now() + 31_000)
      }
      return { job: { id: 'job-9', status: JOB_STATUS.PENDING, error: '' } }
    })

    // The assertion is attached before the clock moves, so the rejection never
    // passes through a tick with no handler on it.
    const rejects = expect(getSchema(3, true)).rejects.toThrow('Schema refresh timed out')
    await vi.advanceTimersByTimeAsync(1000)

    await rejects
  })

  it('does not report a timeout as an empty schema', async () => {
    get.mockImplementation(async (path: string) => {
      if (path.startsWith('jobs/')) {
        vi.setSystemTime(Date.now() + 31_000)
      }
      return { job: { id: 'job-9', status: JOB_STATUS.PENDING, error: '' } }
    })

    const settled = expect(getSchema(3, true)).rejects.toBeInstanceOf(Error)
    await vi.advanceTimersByTimeAsync(1000)

    await settled
  })
})

// The poll is a 30s loop with a 1s sleep in it. Without a signal it outlives the
// page that asked for it, unlike pollJob in jobs.ts next door.
describe('getSchema honours an abort signal', () => {
  it('threads the signal into the schema request itself', async () => {
    get.mockResolvedValue({ schema: [] })
    const controller = new AbortController()

    await getSchema(3, false, controller.signal)

    expect(get).toHaveBeenCalledWith('data_sources/3/schema', {
      params: undefined,
      signal: controller.signal,
    })
  })

  it('threads the signal into each job poll', async () => {
    get
      .mockResolvedValueOnce({ job: { id: 'job-9', status: JOB_STATUS.PENDING, error: '' } })
      .mockResolvedValue({ job: { id: 'job-9', status: JOB_STATUS.SUCCESS, error: '', result: [] } })
    const controller = new AbortController()

    const schema = getSchema(3, true, controller.signal)
    await vi.advanceTimersByTimeAsync(1000)
    await schema

    expect(get).toHaveBeenNthCalledWith(2, 'jobs/job-9', { signal: controller.signal })
  })

  it('refuses to poll at all when the signal is already aborted', async () => {
    get.mockResolvedValue({ job: { id: 'job-9', status: JOB_STATUS.PENDING, error: '' } })
    const controller = new AbortController()
    controller.abort()

    await expect(getSchema(3, true, controller.signal)).rejects.toThrow('Aborted')
    // Only the schema request itself, never a jobs/ poll.
    expect(get.mock.calls.filter(([path]) => String(path).startsWith('jobs/'))).toEqual([])
  })

  it('stops mid-sleep rather than waiting the second out', async () => {
    get.mockResolvedValue({ job: { id: 'job-9', status: JOB_STATUS.PENDING, error: '' } })
    const controller = new AbortController()

    const rejects = expect(getSchema(3, true, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    // Let the first poll land and the 1s interval timer be scheduled.
    await vi.advanceTimersByTimeAsync(0)
    const callsBeforeAbort = get.mock.calls.length
    controller.abort()

    await rejects
    // And it does not sneak in one more poll after the abort.
    await vi.advanceTimersByTimeAsync(3000)
    expect(get).toHaveBeenCalledTimes(callsBeforeAbort)
  })

  it('aborts with a DOMException so a caller can tell it from a real failure', async () => {
    get.mockResolvedValue({ job: { id: 'job-9', status: JOB_STATUS.PENDING, error: '' } })
    const controller = new AbortController()

    const rejects = expect(getSchema(3, true, controller.signal)).rejects.toBeInstanceOf(
      DOMException
    )
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()

    await rejects
  })
})
