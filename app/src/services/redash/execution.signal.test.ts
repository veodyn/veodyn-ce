// A caller that cancels has to reach every hop of an execution.
//
// The signal used to be handed to pollJob only, so aborting during the initial
// POST or during the fetch of the finished result left a request in flight
// whose answer nobody was waiting for. The table preview made that visible: its
// whole read is one POST, so "cancel" reached nothing at all in the common case
// where the result came back inline.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { executeAdhoc, executeSavedQuery, getResult } from './execution'

const post = vi.fn()
const get = vi.fn()

vi.mock('@/services/api-client', () => ({
  redashApi: {
    post: (path: string, data?: unknown, options?: unknown) => post(path, data, options),
    get: (path: string, options?: unknown) => get(path, options),
  },
}))

const RESULT = { id: 1, data: { columns: [], rows: [] }, runtime: 0.1, retrieved_at: '' }

describe('execution threads the abort signal', () => {
  beforeEach(() => {
    post.mockReset()
    get.mockReset()
    post.mockResolvedValue({ query_result: RESULT })
    get.mockResolvedValue({ query_result: RESULT })
  })

  it('gives the ad hoc POST the caller signal', async () => {
    const controller = new AbortController()

    await executeAdhoc(3, 'SELECT 1', { signal: controller.signal })

    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0][2]).toEqual({ signal: controller.signal })
  })

  it('gives the saved-query POST the caller signal', async () => {
    const controller = new AbortController()

    await executeSavedQuery(7, { signal: controller.signal })

    expect(post.mock.calls[0][2]).toEqual({ signal: controller.signal })
  })

  it('gives the stored-result GET the caller signal', async () => {
    const controller = new AbortController()

    await getResult(42, controller.signal)

    expect(get.mock.calls[0][1]).toEqual({ signal: controller.signal })
  })

  it('leaves the signal out when the caller passed none', async () => {
    await executeAdhoc(3, 'SELECT 1')
    await getResult(42)

    expect(post.mock.calls[0][2]).toEqual({ signal: undefined })
    expect(get.mock.calls[0][1]).toEqual({ signal: undefined })
  })
})
