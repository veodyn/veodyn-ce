// Cancelling a run, which is two separate things that both have to happen.
//
// The job has to be cancelled server-side, or the worker keeps burning the
// warehouse quota for rows nobody will read; and the HTTP request has to be
// aborted client-side, or the poll loop keeps running and eventually drops a
// result into a UI that was told the run was cancelled. Doing only one of the
// two looks fine on screen and is wrong underneath, so both are asserted every
// time.
//
// useCancelQuery keeps a zero-argument signature, so it reaches the in-flight
// execution through module state. That state is what these tests exercise:
// which controller is current, and when it stops being current.
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))
vi.mock('@/services/redash/execution', () => ({
  executeSavedQuery: vi.fn(),
  executeAdhoc: vi.fn(),
  getResult: vi.fn(),
  formatQuery: vi.fn(),
}))
vi.mock('@/services/redash/jobs', () => ({ cancelJob: vi.fn(), pollJob: vi.fn() }))

import * as execution from '@/services/redash/execution'
import { cancelJob } from '@/services/redash/jobs'
import { useCancelQuery, useExecuteQuery } from './use-query-execution'

const RESULT = {
  id: 55,
  query_hash: 'h',
  query: 'select 1',
  data: { columns: [], rows: [] },
  data_source_id: 1,
  runtime: 0.01,
  retrieved_at: '2026-07-15T00:00:00Z',
}

function harness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  const { result } = renderHook(() => ({ run: useExecuteQuery(), cancel: useCancelQuery() }), {
    wrapper: Wrapper,
  })
  return result
}

/**
 * A run that hangs until the test lets it finish, holding open the window in
 * which cancelling means anything at all.
 */
function pendingRun() {
  let finish!: () => void
  let signal: AbortSignal | undefined
  let onJob: ((jobId: string) => void) | undefined
  const started = new Promise<void>((resolveStarted) => {
    vi.mocked(execution.executeAdhoc).mockImplementation(async (_dsId, _text, opts) => {
      signal = opts?.signal
      onJob = opts?.onJob
      resolveStarted()
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return RESULT
    })
  })
  return {
    started,
    finish: () => finish(),
    reportJob: (jobId: string) => onJob?.(jobId),
    signal: () => signal,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(cancelJob).mockResolvedValue(undefined)
})

describe('cancelling a run that is in flight', () => {
  it('cancels the job server-side and aborts the request', async () => {
    const run = pendingRun()
    const result = harness()

    act(() => {
      result.current.run.mutate({ queryText: 'select 1', dataSourceId: 1 })
    })
    await run.started
    act(() => run.reportJob('job-1'))

    await act(async () => {
      await result.current.cancel.mutateAsync()
    })

    expect(vi.mocked(cancelJob)).toHaveBeenCalledWith('job-1')
    expect(run.signal()?.aborted).toBe(true)
    run.finish()
  })

  // The abort is the half the client controls. If a refused cancel threw, the
  // request would be left running and the button would report a failure for a
  // run the user has already walked away from.
  it('still aborts when the backend refuses the cancel', async () => {
    const run = pendingRun()
    vi.mocked(cancelJob).mockRejectedValue(new Error('404 no such job'))
    const result = harness()

    act(() => {
      result.current.run.mutate({ queryText: 'select 1', dataSourceId: 1 })
    })
    await run.started
    act(() => run.reportJob('job-2'))

    await act(async () => {
      await result.current.cancel.mutateAsync()
    })

    expect(result.current.cancel.isError).toBe(false)
    expect(run.signal()?.aborted).toBe(true)
    run.finish()
  })

  // Between the POST going out and the job id coming back there is nothing to
  // cancel server-side, but the request itself is still abortable.
  it('aborts a run that has not been given a job id yet', async () => {
    const run = pendingRun()
    const result = harness()

    act(() => {
      result.current.run.mutate({ queryText: 'select 1', dataSourceId: 1 })
    })
    await run.started

    await act(async () => {
      await result.current.cancel.mutateAsync()
    })

    expect(vi.mocked(cancelJob)).not.toHaveBeenCalled()
    expect(run.signal()?.aborted).toBe(true)
    run.finish()
  })

  it('aborts a saved-query run the same way', async () => {
    let signal: AbortSignal | undefined
    let started!: () => void
    const running = new Promise<void>((resolve) => {
      started = resolve
    })
    vi.mocked(execution.executeSavedQuery).mockImplementation(async (_id, opts) => {
      signal = opts?.signal
      opts?.onJob?.('job-3')
      started()
      await new Promise(() => {})
      return RESULT
    })
    const result = harness()

    act(() => {
      result.current.run.mutate({
        queryId: 8,
        queryText: 'select 1',
        dataSourceId: 1,
        savedQuery: true,
      })
    })
    await running

    await act(async () => {
      await result.current.cancel.mutateAsync()
    })

    expect(vi.mocked(cancelJob)).toHaveBeenCalledWith('job-3')
    expect(signal?.aborted).toBe(true)
  })
})

describe('cancelling when nothing is running', () => {
  // The controller of a finished run must stop being the current one. Holding
  // on to it means a stray Cancel aborts whatever ran next, or worse, aborts a
  // controller whose request already delivered and reports a cancellation for a
  // result the user is looking at.
  it('does not touch the controller of a run that already finished', async () => {
    let signal: AbortSignal | undefined
    vi.mocked(execution.executeAdhoc).mockImplementation(async (_dsId, _text, opts) => {
      signal = opts?.signal
      opts?.onJob?.('job-4')
      return RESULT
    })
    const result = harness()

    await act(async () => {
      await result.current.run.mutateAsync({ queryText: 'select 1', dataSourceId: 1 })
    })
    await waitFor(() => expect(result.current.run.isSuccess).toBe(true))
    vi.mocked(cancelJob).mockClear()

    await act(async () => {
      await result.current.cancel.mutateAsync()
    })

    expect(vi.mocked(cancelJob)).not.toHaveBeenCalled()
    expect(signal?.aborted).toBe(false)
  })

  it('lets go of a run that failed, too', async () => {
    let signal: AbortSignal | undefined
    vi.mocked(execution.executeAdhoc).mockImplementation(async (_dsId, _text, opts) => {
      signal = opts?.signal
      throw new Error('syntax error at or near "slect"')
    })
    const result = harness()

    await act(async () => {
      await result.current.run
        .mutateAsync({ queryText: 'slect 1', dataSourceId: 1 })
        .catch(() => {})
    })
    await waitFor(() => expect(result.current.run.isError).toBe(true))

    await act(async () => {
      await result.current.cancel.mutateAsync()
    })

    expect(signal?.aborted).toBe(false)
  })

  it('resolves rather than throwing when there was never a run', async () => {
    const result = harness()

    await act(async () => {
      await result.current.cancel.mutateAsync()
    })

    await waitFor(() => expect(result.current.cancel.isSuccess).toBe(true))
    expect(vi.mocked(cancelJob)).not.toHaveBeenCalled()
  })
})
