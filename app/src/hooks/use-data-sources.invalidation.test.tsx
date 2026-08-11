// Which cached reads each data source write repairs.
//
// There are two entries per data source: the list (['data-sources']) and the
// source's own detail entry (['data-source', id]). Every write here happens on
// a page that is showing the detail entry, so a write that heals only the list
// leaves the page it was made from displaying the state from before it.
//
// Refetches are counted through the app's own hooks rather than through a spy
// on invalidateQueries, so invalidating a key nothing reads fails here.
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))
vi.mock('@/services/redash/data-sources', () => ({
  listDataSources: vi.fn(),
  getDataSource: vi.fn(),
  listTypes: vi.fn(),
  getSchema: vi.fn(),
  createDataSource: vi.fn(),
  updateDataSource: vi.fn(),
  deleteDataSource: vi.fn(),
  pauseDataSource: vi.fn(),
  resumeDataSource: vi.fn(),
  testConnection: vi.fn(),
}))

import * as service from '@/services/redash/data-sources'
import {
  useCreateDataSource,
  useDataSource,
  useDataSources,
  useDeleteDataSource,
  usePauseDataSource,
  useResumeDataSource,
  useUpdateDataSource,
} from './use-data-sources'

const SOURCE_ID = 3
const OTHER_ID = 4

const SOURCE = { id: SOURCE_ID, name: 'Transit warehouse', type: 'clickhouse' }

function harness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  const { result } = renderHook(
    () => ({
      list: useDataSources(),
      detail: useDataSource(SOURCE_ID),
      otherDetail: useDataSource(OTHER_ID),
      create: useCreateDataSource(),
      update: useUpdateDataSource(),
      remove: useDeleteDataSource(),
      pause: usePauseDataSource(),
      resume: useResumeDataSource(),
    }),
    { wrapper: Wrapper }
  )
  return result
}

async function settled() {
  const result = harness()
  await waitFor(() => {
    expect(result.current.list.isSuccess).toBe(true)
    expect(result.current.detail.isSuccess).toBe(true)
    expect(result.current.otherDetail.isSuccess).toBe(true)
  })
  return result
}

function counts() {
  const gets = vi.mocked(service.getDataSource).mock.calls
  return {
    list: vi.mocked(service.listDataSources).mock.calls.length,
    detail: gets.filter((c) => c[0] === SOURCE_ID).length,
    other: gets.filter((c) => c[0] === OTHER_ID).length,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(service.listDataSources).mockResolvedValue([SOURCE])
  vi.mocked(service.getDataSource).mockResolvedValue(SOURCE)
  vi.mocked(service.createDataSource).mockResolvedValue({ ...SOURCE, id: 9 })
  vi.mocked(service.updateDataSource).mockResolvedValue(SOURCE)
  vi.mocked(service.deleteDataSource).mockResolvedValue(undefined)
  vi.mocked(service.pauseDataSource).mockResolvedValue({ ...SOURCE, paused: 1 })
  vi.mocked(service.resumeDataSource).mockResolvedValue({ ...SOURCE, paused: 0 })
})

describe('writes that repair the list', () => {
  it('refreshes the list after a create, which has no detail entry of its own yet', async () => {
    const result = await settled()
    const before = counts()

    await act(async () => {
      await result.current.create.mutateAsync({
        name: 'New warehouse',
        type: 'clickhouse',
        syntax: 'sql',
        paused: 0,
        pause_reason: null,
        options: {},
        groups: {},
        view_only: false,
      })
    })

    await waitFor(() => expect(counts().list).toBe(before.list + 1))
    expect(counts().detail).toBe(before.detail)
  })

  it('refreshes the list after a delete', async () => {
    const result = await settled()
    const before = counts()

    await act(async () => {
      await result.current.remove.mutateAsync(SOURCE_ID)
    })

    await waitFor(() => expect(counts().list).toBe(before.list + 1))
  })

  it('refreshes both the list and the edited source after an update', async () => {
    const result = await settled()
    const before = counts()

    await act(async () => {
      await result.current.update.mutateAsync({ id: SOURCE_ID, name: 'Renamed warehouse' })
    })

    await waitFor(() => expect(counts().detail).toBe(before.detail + 1))
    expect(counts().list).toBe(before.list + 1)
    // A sibling source that was not edited must not be refetched.
    expect(counts().other).toBe(before.other)
  })

  it('refreshes nothing when the write was refused', async () => {
    const result = await settled()
    vi.mocked(service.updateDataSource).mockRejectedValue(new Error('403'))
    const before = counts()

    await act(async () => {
      await result.current.update
        .mutateAsync({ id: SOURCE_ID, name: 'Renamed warehouse' })
        .catch(() => {})
    })

    await waitFor(() => expect(result.current.update.isError).toBe(true))
    expect(counts()).toEqual(before)
  })
})

/**
 * The pause control on /data-sources/[dataSourceId] is driven entirely by the
 * `paused` prop the page reads out of useDataSource(id). Healing only the list
 * left the card still offering to pause a source that was already paused, until
 * something unrelated refetched that entry.
 */
describe('pause and resume repair the source they changed', () => {
  it('refreshes both the list and the paused source itself', async () => {
    const result = await settled()
    const before = counts()

    await act(async () => {
      await result.current.pause.mutateAsync({ id: SOURCE_ID, reason: 'Vehicle feed stalled' })
    })

    await waitFor(() => expect(counts().detail).toBe(before.detail + 1))
    expect(counts().list).toBe(before.list + 1)
    // A sibling source that was not paused must not be refetched.
    expect(counts().other).toBe(before.other)
    expect(vi.mocked(service.pauseDataSource)).toHaveBeenCalledWith(SOURCE_ID, 'Vehicle feed stalled')
  })

  it('refreshes both the list and the resumed source itself', async () => {
    const result = await settled()
    const before = counts()

    await act(async () => {
      await result.current.resume.mutateAsync(SOURCE_ID)
    })

    await waitFor(() => expect(counts().detail).toBe(before.detail + 1))
    expect(counts().list).toBe(before.list + 1)
    expect(counts().other).toBe(before.other)
    expect(vi.mocked(service.resumeDataSource)).toHaveBeenCalledWith(SOURCE_ID)
  })

  // The three writes reachable from the detail page all heal the same entry.
  it('matches the update next door on the same page', async () => {
    const result = await settled()
    const before = counts()

    await act(async () => {
      await result.current.update.mutateAsync({ id: SOURCE_ID, name: 'Renamed' })
    })
    await waitFor(() => expect(counts().detail).toBe(before.detail + 1))
    const afterUpdate = counts()

    await act(async () => {
      await result.current.pause.mutateAsync({ id: SOURCE_ID })
    })

    await waitFor(() => expect(counts().detail).toBe(afterUpdate.detail + 1))
    expect(counts().list).toBe(afterUpdate.list + 1)
  })

  // Counting refetches proves the cache moved, but not which key was named. A
  // pause that invalidated everything would pass the counts above and quietly
  // refetch every unrelated list in the app, so the exact key is asserted too.
  it('names the detail key rather than invalidating the whole cache', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const spy = vi.spyOn(qc, 'invalidateQueries')
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    }
    const { result } = renderHook(
      () => ({ pause: usePauseDataSource(), resume: useResumeDataSource() }),
      { wrapper: Wrapper }
    )

    await act(async () => {
      await result.current.pause.mutateAsync({ id: SOURCE_ID })
    })

    expect(spy).toHaveBeenCalledWith({ queryKey: ['data-source', SOURCE_ID] })
    spy.mockClear()

    await act(async () => {
      await result.current.resume.mutateAsync(SOURCE_ID)
    })

    expect(spy).toHaveBeenCalledWith({ queryKey: ['data-source', SOURCE_ID] })
  })
})
