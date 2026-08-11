import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useOptimisticTags } from './use-optimistic-tags'

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: toastError, info: vi.fn(), warning: vi.fn() },
}))

const KEY = ['query', 1]

interface Cached {
  id: number
  name: string
  tags: string[]
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function provider(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

function setup(write: (tags: string[], options: { onError: () => void }) => void) {
  const qc = client()
  qc.setQueryData<Cached>(KEY, { id: 1, name: 'Rail boardings', tags: ['rail'] })

  const { result } = renderHook(() => useOptimisticTags(KEY, write), { wrapper: provider(qc) })

  return { qc, save: result.current }
}

beforeEach(() => {
  toastError.mockClear()
})

describe('useOptimisticTags', () => {
  it('shows the new tags before the write has been answered', () => {
    // Never answers, so anything visible afterwards can only be the optimism.
    const { qc, save } = setup(() => {})

    act(() => save(['rail', 'ridership']))

    expect(qc.getQueryData<Cached>(KEY)?.tags).toEqual(['rail', 'ridership'])
  })

  it('leaves the rest of the cached object alone', () => {
    const { qc, save } = setup(() => {})

    act(() => save(['ridership']))

    // A rewrite that replaced the entry with `{ tags }` would blank the page
    // it was rendered from, which is worse than the round trip it saves.
    expect(qc.getQueryData<Cached>(KEY)).toEqual({
      id: 1,
      name: 'Rail boardings',
      tags: ['ridership'],
    })
  })

  it('hands the array to the write untouched, reserved tags included', () => {
    const write = vi.fn()
    const { save } = setup(write)

    act(() => save(['domain:rail', 'ridership']))

    expect(write.mock.calls[0][0]).toEqual(['domain:rail', 'ridership'])
  })

  it('puts the previous tags back and says so when the write is refused', () => {
    const { qc, save } = setup((_tags, options) => options.onError())

    act(() => save(['rail', 'ridership']))

    // Not "some earlier state": exactly what was cached before the click, so a
    // refused write cannot leave a tag on screen that no backend has. Nothing
    // is observing this key, so the invalidation cannot refetch and this
    // asserts the rollback on its own.
    expect(qc.getQueryData<Cached>(KEY)).toEqual({
      id: 1,
      name: 'Rail boardings',
      tags: ['rail'],
    })
    expect(toastError).toHaveBeenCalledWith('Could not save those tags.', expect.anything())
  })

  it('still attempts the write when nothing is cached to roll back to', () => {
    const write = vi.fn()
    const qc = client()
    const { result } = renderHook(() => useOptimisticTags(['query', 99], write), {
      wrapper: provider(qc),
    })

    act(() => result.current(['rail']))

    // The detail page can save before its own query has been read into the
    // cache under this key, and a guard that skipped the write there would look
    // exactly like a tag that refuses to save.
    expect(write).toHaveBeenCalledTimes(1)
    expect(qc.getQueryData(['query', 99])).toBeUndefined()
  })

  // Two writes in flight at once, both refused. The rollback snapshot cannot
  // settle this on its own: the second call captured the FIRST one's optimistic
  // array, so whichever failure is handled last decides what stays on screen,
  // and one of the two answers is a tag no backend ever stored.
  it('converges on the server value when two overlapping writes both fail', async () => {
    const qc = client()
    // Server truth. Neither "alpha" nor "beta" is in it, because neither write
    // landed.
    const server: Cached = { id: 1, name: 'Rail boardings', tags: ['domain:rail'] }
    const refuse: Array<() => void> = []

    const { result } = renderHook(
      () => ({
        // A real observer, so the invalidation has something to refetch, which
        // is what a detail page has when someone is clicking on its chips.
        query: useQuery({ queryKey: KEY, queryFn: () => ({ ...server }) }),
        save: useOptimisticTags(KEY, (_tags, options) => refuse.push(options.onError)),
      }),
      { wrapper: provider(qc) }
    )

    await waitFor(() => expect(result.current.query.data).toEqual(server))

    act(() => result.current.save(['domain:rail', 'alpha']))
    act(() => result.current.save(['domain:rail', 'alpha', 'beta']))

    // The second failure is handled last, so its snapshot is the one that would
    // win: ["domain:rail", "alpha"], which is the state this test exists to
    // reject.
    act(() => refuse[0]())
    act(() => refuse[1]())

    await waitFor(() => {
      expect(qc.getQueryData<Cached>(KEY)?.tags).toEqual(['domain:rail'])
    })
  })
})
