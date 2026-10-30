import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

function failedWith(error: unknown) {
  get
    .mockResolvedValueOnce({ job: { id: 'job-9', status: JOB_STATUS.PENDING, error: '' } })
    .mockResolvedValue({ job: { id: 'job-9', status: JOB_STATUS.FAILURE, error } })
}

describe('getSchema for a data source that cannot list a schema', () => {
  it('answers an empty schema when the runner reports it does not support one', async () => {
    failedWith({ code: 1, message: 'Data source type does not support retrieving schema' })

    const schema = getSchema(15)
    await vi.advanceTimersByTimeAsync(1000)

    await expect(schema).resolves.toEqual([])
  })

  it('surfaces the message of any other structured failure', async () => {
    failedWith({ code: 2, message: 'Error retrieving schema', details: 'connection refused' })

    const rejects = expect(getSchema(15)).rejects.toThrow('Error retrieving schema')
    await vi.advanceTimersByTimeAsync(1000)

    await rejects
  })
})
