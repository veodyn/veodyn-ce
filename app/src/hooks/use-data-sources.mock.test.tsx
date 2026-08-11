// Data source writes with no backend, which is the mode the demo runs in.
//
// The pause reason is the interesting one. It is free text from an input that
// starts empty, so "no reason given" arrives as '' or as whitespace, and it has
// to be stored as null: the detail page renders the reason only when it is
// truthy, and a blank string is a paragraph of nothing under a heading.
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MockDataSource } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import {
  useCreateDataSource,
  useDataSourceTypes,
  useDataSource,
  useDataSourceSchema,
  useDataSources,
  useDeleteDataSource,
  usePauseDataSource,
  useResumeDataSource,
  useTestConnection,
  useUpdateDataSource,
} from './use-data-sources'

const SOURCE_ID = 930

function source(overrides: Partial<MockDataSource> = {}): MockDataSource {
  return {
    id: SOURCE_ID,
    name: 'Transit warehouse',
    type: 'clickhouse',
    syntax: 'sql',
    paused: 0,
    pause_reason: null,
    options: { dbname: 'transit' },
    groups: {},
    created_at: '2026-07-01T00:00:00Z',
    view_only: false,
    ...overrides,
  } as MockDataSource
}

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
      create: useCreateDataSource(),
      update: useUpdateDataSource(),
      remove: useDeleteDataSource(),
      pause: usePauseDataSource(),
      resume: useResumeDataSource(),
      test: useTestConnection(),
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
  })
  return result
}

function stored() {
  return useMockDataStore.getState().dataSources.find((ds) => ds.id === SOURCE_ID)
}

beforeEach(() => {
  useMockDataStore.setState({ dataSources: [source()] })
})

describe('pausing and resuming with no backend', () => {
  it('records the reason that was typed', async () => {
    const result = await settled()

    await act(async () => {
      await result.current.pause.mutateAsync({ id: SOURCE_ID, reason: 'Vehicle feed stalled' })
    })

    await waitFor(() => expect(stored()?.paused).toBe(1))
    expect(stored()?.pause_reason).toBe('Vehicle feed stalled')
  })

  it('stores a blank reason as none at all', async () => {
    const result = await settled()

    await act(async () => {
      await result.current.pause.mutateAsync({ id: SOURCE_ID, reason: '   ' })
    })

    await waitFor(() => expect(stored()?.paused).toBe(1))
    expect(stored()?.pause_reason).toBeNull()
  })

  it('pauses with no reason at all', async () => {
    const result = await settled()

    await act(async () => {
      await result.current.pause.mutateAsync({ id: SOURCE_ID })
    })

    await waitFor(() => expect(stored()?.paused).toBe(1))
    expect(stored()?.pause_reason).toBeNull()
  })

  // The reason describes the pause, so it goes when the pause goes: a stale
  // reason left on a running source is shown by anything that renders it.
  it('clears the reason along with the pause on resume', async () => {
    useMockDataStore.setState({
      dataSources: [source({ paused: 1, pause_reason: 'Vehicle feed stalled' })],
    })
    const result = await settled()

    await act(async () => {
      await result.current.resume.mutateAsync(SOURCE_ID)
    })

    await waitFor(() => expect(stored()?.paused).toBe(0))
    expect(stored()?.pause_reason).toBeNull()
  })

  it('shows the pause on the list read without a reload', async () => {
    const result = await settled()

    await act(async () => {
      await result.current.pause.mutateAsync({ id: SOURCE_ID, reason: 'stalled' })
    })

    await waitFor(() => expect(result.current.list.data?.[0].paused).toBe(1))
  })
})

describe('creating, editing and deleting with no backend', () => {
  it('stamps a created_at and an id nothing else holds', async () => {
    const result = await settled()

    const created = await act(async () =>
      result.current.create.mutateAsync({
        name: 'Second warehouse',
        type: 'clickhouse',
        syntax: 'sql',
        paused: 0,
        pause_reason: null,
        options: {},
        groups: {},
        view_only: false,
      })
    )

    expect(created.id).not.toBe(SOURCE_ID)
    expect(created.created_at).not.toBe('')
    const ids = useMockDataStore.getState().dataSources.map((ds) => ds.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('resolves an edit with the renamed source, not the one from before the write', async () => {
    const result = await settled()

    const updated = await act(async () =>
      result.current.update.mutateAsync({ id: SOURCE_ID, name: 'Renamed warehouse' })
    )

    expect(updated.name).toBe('Renamed warehouse')
  })

  it('leaves the connection options alone when only the name changed', async () => {
    const result = await settled()

    await act(async () => {
      await result.current.update.mutateAsync({ id: SOURCE_ID, name: 'Renamed warehouse' })
    })

    await waitFor(() => expect(stored()?.name).toBe('Renamed warehouse'))
    expect(stored()?.options).toEqual({ dbname: 'transit' })
  })

  it('takes a deleted source off the list without a reload', async () => {
    const result = await settled()

    await act(async () => {
      await result.current.remove.mutateAsync(SOURCE_ID)
    })

    await waitFor(() => expect(result.current.list.data).toEqual([]))
    expect(stored()).toBeUndefined()
  })
})

describe('reads with no backend', () => {
  it('answers null for a data source the store does not have', async () => {
    useMockDataStore.setState({ dataSources: [] })
    const result = await settled()

    expect(result.current.detail.data).toBeNull()
    expect(result.current.detail.isError).toBe(false)
  })

  // No fixture schema for this id is an empty schema, not a crash: the editor's
  // schema pane renders for every source, including ones nothing was written
  // for.
  it('answers an empty schema for a source no fixture describes', async () => {
    const { result } = renderHook(() => useDataSourceSchema(SOURCE_ID), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          {children}
        </QueryClientProvider>
      ),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([])
  })

  // The form needs a type list to render its fields at all, so the fixture set
  // has to arrive even with nothing to ask.
  it('offers the fixture type list to the form', async () => {
    const { result } = renderHook(() => useDataSourceTypes(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          {children}
        </QueryClientProvider>
      ),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.length).toBeGreaterThan(0)
    expect(result.current.data?.every((t) => typeof t.type === 'string')).toBe(true)
  })

  it('reports a connection test as successful without a backend to test', async () => {
    const result = await settled()

    const answer = await act(async () => result.current.test.mutateAsync(SOURCE_ID))

    expect(answer.ok).toBe(true)
  })
})
