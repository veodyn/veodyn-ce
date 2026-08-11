// The write path for the three kinds veodyn-api owns. What is pinned here is
// what the cache holds after a write, not which TanStack call was made: a spy
// on `cancelQueries` or `invalidateQueries` would pass an implementation that
// made the call against the wrong key.
//
// The real tag client runs; only `fetch` is stubbed, so the error envelope
// veodyn-api puts on the wire is parsed by the code that will parse it in
// production rather than by the test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useObjectTags } from './use-object-tags'

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: toastError, info: vi.fn(), warning: vi.fn() },
}))

const DETAIL = ['kpi', 'k-1']

interface CachedKpi {
  id: string
  name: string
  tags: string[]
}

function kpi(tags: string[]): CachedKpi {
  return { id: 'k-1', name: 'Boardings', tags }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** The envelope veodyn-api puts every refusal in (`veodyn_api/errors.py`). */
function errorBody(id: string, message: string) {
  return { error: { id, message } }
}

/** A detail page: the object's own query, plus the control's save callback. */
function harness(queryFn: () => Promise<CachedKpi>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { result } = renderHook(
    () => ({
      query: useQuery({ queryKey: DETAIL, queryFn }),
      tags: useObjectTags('kpi', 'k-1'),
    }),
    {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    }
  )
  return { qc, result }
}

function cachedTags(qc: QueryClient): string[] | undefined {
  return qc.getQueryData<CachedKpi>(DETAIL)?.tags
}

beforeEach(() => {
  toastError.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useObjectTags, a successful write', () => {
  // The failure this rejects: a GET issued before the write answers during it,
  // putting pre-write data back, so the chip someone just added vanishes off
  // the screen while their save is still in the air.
  //
  // The write here never answers, so nothing but the cancellation can keep the
  // optimistic array on screen. Invalidating on success does not cover this
  // window: there has been no success yet.
  it('is not undone by a detail GET that was in flight when the write started', async () => {
    const release: Array<() => void> = []
    let staleAnswered = false
    const queryFn = vi.fn(async (): Promise<CachedKpi> => {
      if (queryFn.mock.calls.length === 2) {
        // The older GET: window focus, a poll, a sibling mounting. It read
        // before the write and hangs until this test lets it answer.
        await new Promise<void>((resolve) => release.push(resolve))
        staleAnswered = true
      }
      return kpi([])
    })

    const { qc, result } = harness(queryFn)
    await waitFor(() => expect(result.current.query.data).toEqual(kpi([])))

    act(() => void qc.refetchQueries({ queryKey: DETAIL }))
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))

    // Never answers, so the write stays in flight for the rest of the test.
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>(() => {}))
    act(() => result.current.tags.saveTags(['rail']))
    await waitFor(() => expect(cachedTags(qc)).toEqual(['rail']))

    // The older GET answers now, carrying the object as it was before the write.
    act(() => release[0]?.())
    await waitFor(() => expect(staleAnswered).toBe(true))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(cachedTags(qc)).toEqual(['rail'])
  })

  it('refetches the detail entry rather than trusting the response it patched in', async () => {
    // The mutation response is hand-written into the cache, which is not the
    // same as having read the object. A tag someone else added in the meantime,
    // or any other field the write moved, arrives only on a real read.
    const queryFn = vi.fn(async (): Promise<CachedKpi> => {
      return queryFn.mock.calls.length === 1 ? kpi([]) : kpi(['rail', 'fleet'])
    })
    const { qc, result } = harness(queryFn)
    await waitFor(() => expect(result.current.query.data).toEqual(kpi([])))

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ tags: ['rail'] }))
    act(() => result.current.tags.saveTags(['rail']))

    await waitFor(() => expect(cachedTags(qc)).toEqual(['rail', 'fleet']))
  })
})

describe('useObjectTags, a refused write', () => {
  // Two writes in flight at once, both refused. The rollback snapshot cannot
  // settle this alone: the second call captured the FIRST one's optimistic
  // array, so whichever failure is handled last decides what stays on screen,
  // and one of those two answers is a tag the server never stored.
  it('converges on the server value when two overlapping writes both fail', async () => {
    const { qc, result } = harness(async () => kpi(['domain:rail']))
    await waitFor(() => expect(result.current.query.data).toEqual(kpi(['domain:rail'])))

    const refuse: Array<(res: Response) => void> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise<Response>((resolve) => refuse.push(resolve))
    )

    act(() => result.current.tags.saveTags(['domain:rail', 'alpha']))
    act(() => result.current.tags.saveTags(['domain:rail', 'alpha', 'beta']))
    // Both optimistic writes landed, in order, which is what makes the second
    // one's rollback snapshot the intermediate array rather than server truth.
    await waitFor(() => expect(cachedTags(qc)).toEqual(['domain:rail', 'alpha', 'beta']))

    // The second failure is handled last, so its snapshot is the one that would
    // win: ["domain:rail", "alpha"], which is the state this test rejects.
    await act(async () => {
      refuse[0]?.(jsonResponse(errorBody('VEODYN_KPI_NOT_FOUND', 'gone'), 404))
      refuse[1]?.(jsonResponse(errorBody('VEODYN_KPI_NOT_FOUND', 'gone'), 404))
      await Promise.resolve()
    })

    await waitFor(() => expect(cachedTags(qc)).toEqual(['domain:rail']))
  })
})

describe('useObjectTags failure messages', () => {
  async function refuseWith(body: unknown, status: number) {
    const { result } = harness(async () => kpi([]))
    await waitFor(() => expect(result.current.query.data).toEqual(kpi([])))

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(body, status))
    act(() => result.current.tags.saveTags(['rail']))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    return String(toastError.mock.calls[0][0])
  }

  it('names the reserved prefix when that is the cause the backend gave', async () => {
    const message = await refuseWith(errorBody('VEODYN_TAG_PREFIX_RESERVED', 'reserved'), 422)
    expect(message).toContain('domain:')
  })

  // The bug this rejects: every 422 read as a reserved prefix. veodyn-api also
  // answers 422 for a tag over 100 characters and a set over 50 tags, and
  // telling that person to change a prefix they never typed is a false
  // remediation.
  //
  // The two caps are asserted apart rather than together. They are separate
  // causes on the wire with separate remediations, and a single test accepting
  // either message would pass an implementation that answered "shorten this
  // tag" to someone who hit the count cap.
  it('names the length cap, and only it, when a tag is too long', async () => {
    const message = await refuseWith(errorBody('VEODYN_TAG_TOO_LONG', 'too long'), 422)
    expect(message).not.toContain('domain:')
    expect(message).toContain('100')
    expect(message).not.toContain('50')
  })

  it('names the count cap, and only it, when there are too many tags', async () => {
    const message = await refuseWith(errorBody('VEODYN_TOO_MANY_TAGS', 'too many'), 422)
    expect(message).not.toContain('domain:')
    expect(message).toContain('50')
    expect(message).not.toContain('100')
  })

  // A body the endpoint could not read is no longer a size violation: it must
  // not claim a cap the caller never hit.
  it('stays generic for an unreadable body', async () => {
    const message = await refuseWith(errorBody('VEODYN_INVALID_REQUEST', 'not a list'), 422)
    expect(message).toBe('Could not save those tags.')
  })

  it('falls back to the generic message for a 422 cause it does not recognize', async () => {
    const message = await refuseWith(errorBody('VEODYN_SOMETHING_NEW', 'nope'), 422)
    expect(message).toBe('Could not save those tags.')
  })

  it('reports a locked report by its cause rather than by its status', async () => {
    const message = await refuseWith(errorBody('VEODYN_REPORT_EDIT_LOCKED', 'in review'), 409)
    expect(message).toContain('review')
  })

  it('reports an unconfigured backend from the proxy 503, which carries no cause', async () => {
    const message = await refuseWith({ error: 'veodyn-api not configured' }, 503)
    expect(message).toBe('Tagging is not configured on this server.')
  })
})
