import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

// USE_REAL_API is a module constant, so it is read through a getter here: one
// file has to cover both the fixture-derived vocabulary and the merged one.
const flags = vi.hoisted(() => ({ real: false }))
vi.mock('@/services/redash/config', () => ({
  get USE_REAL_API() {
    return flags.real
  },
}))

vi.mock('@/services/tags/client', () => ({
  fetchRedashTagVocabulary: vi.fn(),
  fetchTagVocabulary: vi.fn(),
}))

import { useTagVocabulary } from './use-tag-vocabulary'
import { useMockDataStore } from '@/stores/mock-data-store'
import { storeCollections } from '@/stores/mock-data-hydration'
import { fetchRedashTagVocabulary, fetchTagVocabulary } from '@/services/tags/client'

const redashTags = vi.mocked(fetchRedashTagVocabulary)
const sidecarTags = vi.mocked(fetchTagVocabulary)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children)
  }
  return Wrapper
}

/** Settled data, skipping the placeholder the hook hands out while loading. */
async function settled() {
  const { result } = renderHook(() => useTagVocabulary(), { wrapper: makeWrapper() })
  await waitFor(() => expect(result.current.isFetching).toBe(false))
  return result.current.data ?? []
}

beforeEach(() => {
  flags.real = false
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useTagVocabulary (real mode)', () => {
  beforeEach(() => {
    flags.real = true
  })

  // The merge is the whole reason this hook exists. An implementation that
  // takes the largest count, or the last source to answer, or that emits one
  // entry per source, fails on `rail`.
  it('sums the count for a name that appears in more than one source', async () => {
    redashTags.mockImplementation(async (scope) =>
      scope === 'queries'
        ? [
            { name: 'rail', count: 8 },
            { name: 'domain:transit', count: 3 },
          ]
        : [{ name: 'rail', count: 4 }]
    )
    sidecarTags.mockResolvedValue([
      { name: 'rail', count: 1 },
      { name: 'ridership', count: 2 },
    ])

    expect(await settled()).toEqual([
      { name: 'rail', count: 13 },
      { name: 'ridership', count: 2 },
    ])
  })

  it('reads all three sources, Redash queries and dashboards plus the sidecar', async () => {
    redashTags.mockResolvedValue([])
    sidecarTags.mockResolvedValue([])
    await settled()

    expect(redashTags).toHaveBeenCalledWith('queries', expect.anything())
    expect(redashTags).toHaveBeenCalledWith('dashboards', expect.anything())
    expect(sidecarTags).toHaveBeenCalledWith(expect.anything())
  })

  // Non-fatal, per source: one backend being down degrades the suggestions, it
  // does not take tagging out.
  it('keeps the surviving sources when one of them fails', async () => {
    redashTags.mockImplementation(async (scope) => {
      if (scope === 'queries') throw new Error('redash down')
      return [{ name: 'mobility', count: 2 }]
    })
    sidecarTags.mockResolvedValue([{ name: 'mobility', count: 1 }])

    expect(await settled()).toEqual([{ name: 'mobility', count: 3 }])
  })

  it('returns an empty list rather than an error when every source fails', async () => {
    redashTags.mockRejectedValue(new Error('down'))
    sidecarTags.mockRejectedValue(new Error('down'))

    const { result } = renderHook(() => useTagVocabulary(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isFetching).toBe(false))

    expect(result.current.data).toEqual([])
    expect(result.current.isError).toBe(false)
  })
})

describe('useTagVocabulary (mock mode)', () => {
  it('never calls a backend', async () => {
    await settled()
    expect(redashTags).not.toHaveBeenCalled()
    expect(sidecarTags).not.toHaveBeenCalled()
  })

  // Every collection, not a named five. The hook stopped naming them so a
  // community build has no `s.kpis` read in it, and the enterprise half of this
  // coverage (that a tag carried only by a KPI or only by a report reaches the
  // vocabulary) is use-tag-vocabulary.enterprise.test.ts.
  it('sums a fixture tag across the stores that carry it', async () => {
    const lists = storeCollections(useMockDataStore.getState())
    const perSource = lists.map(
      (list) =>
        list.filter((o) => ((o as { tags?: string[] }).tags ?? []).includes('bike-share')).length
    )
    const total = perSource.reduce((a, b) => a + b, 0)
    // Guards the assertion below: if no fixture tag spanned two stores, a
    // max-taking implementation would pass the count check by accident.
    expect(total).toBeGreaterThan(Math.max(...perSource))

    const data = await settled()
    expect(data.find((t) => t.name === 'bike-share')).toEqual({
      name: 'bike-share',
      count: total,
    })
  })

  it('suggests no reserved tag, whatever the fixtures carry', async () => {
    useMockDataStore.setState((s) => ({
      datasets: [{ ...s.datasets[0], tags: ['domain:transit', 'rail'] }, ...s.datasets.slice(1)],
    }))
    const data = await settled()

    expect(data.some((t) => t.name.startsWith('domain:'))).toBe(false)
    expect(data.some((t) => t.name === 'rail')).toBe(true)
  })
})
