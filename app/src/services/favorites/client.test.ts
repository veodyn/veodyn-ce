// The favorites client: which verb means what, and what a bad answer does.
//
// POST adds and DELETE removes, which is Redash's own convention for the two
// object kinds it owns. Getting that pair backwards would unstar on click and
// look like a backend that ignores writes, so it is pinned here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchFavorites, setFavorite } from './client'
import { ErrorIds, isAppError } from '@/lib/errorIds'
import type { FeatureDescriptor } from '@/features/types'

// An explicit two-kind registry, and not the one this build happens to hold.
//
// `fetchFavorites` seeds one empty list per starrable kind before it copies the
// answer over them, so what a missing list defaults to depends entirely on
// which kinds the registry names. Stubbing it here is what makes the case below
// say the same thing in a tree with feature packages and in one without: the
// mechanism is the seeding, not the two words this stub happens to use.
vi.mock('@/features/generated-registry', async () => {
  const { Star } = await import('lucide-react')
  const FEATURES: Record<string, FeatureDescriptor> = {
    kpis: {
      id: 'kpis',
      nav: [],
      routes: [],
      searchType: { type: 'kpi', label: 'KPIs', noun: 'KPI', icon: Star },
      slots: { 'favorites.section': async () => ({ default: () => null }) },
    },
    reports: {
      id: 'reports',
      nav: [],
      routes: [],
      searchType: { type: 'report', label: 'Reports', noun: 'report', icon: Star },
      slots: { 'favorites.section': async () => ({ default: () => null }) },
    },
  }
  return { FEATURES }
})

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

describe('fetchFavorites', () => {
  it('reads the caller-scoped id sets', async () => {
    fetchMock.mockResolvedValue(ok({ kpi: ['on-time'], report: ['q3'] }))

    await expect(fetchFavorites()).resolves.toEqual({ kpi: ['on-time'], report: ['q3'] })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/favorites')
    // The browser's own session decides whose favorites these are.
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  })

  // Both kinds come from the stub registry above, so this reads a build with
  // two starrable kinds whatever the tree it runs in has installed. A backend
  // that answers without one of the lists must not turn every row on that page
  // into "not favorited" by way of a crash in the caller.
  it('defaults a missing list rather than letting it reach a caller', async () => {
    fetchMock.mockResolvedValue(ok({ kpi: ['on-time'] }))

    await expect(fetchFavorites()).resolves.toEqual({ kpi: ['on-time'], report: [] })
  })

  it('fails with a registry id, not a bare Error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })

    const error = await fetchFavorites().catch((e: unknown) => e)
    expect(isAppError(error) && error.id).toBe(ErrorIds.FAVORITES_REQUEST_FAILED)
  })
})

describe('setFavorite', () => {
  it('POSTs to add', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 })

    await setFavorite('kpi', 'on-time', true)

    expect(fetchMock.mock.calls[0][0]).toBe('/api/favorites/kpi/on-time')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
  })

  it('DELETEs to remove', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 })

    await setFavorite('report', 'q3', false)

    expect(fetchMock.mock.calls[0][0]).toBe('/api/favorites/report/q3')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
  })

  it('escapes an id that would otherwise change the path', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 })

    await setFavorite('kpi', 'a/b?c', true)

    expect(fetchMock.mock.calls[0][0]).toBe('/api/favorites/kpi/a%2Fb%3Fc')
  })

  it('surfaces a refused write instead of reporting success', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 })

    const error = await setFavorite('kpi', 'gone', true).catch((e: unknown) => e)
    expect(isAppError(error) && error.id).toBe(ErrorIds.FAVORITES_REQUEST_FAILED)
  })
})
