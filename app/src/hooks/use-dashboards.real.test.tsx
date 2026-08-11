// The dashboard reads that only exist against a real backend, and what each of
// them does when the backend does not answer.
//
// Every dashboard list renders an empty state, and every one of them would
// render that same empty state for a refused request if the hook reported only
// {data, isLoading}. "You have no dashboards" for an org with two hundred of
// them is the failure nobody files, because it does not look like a failure.
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))
vi.mock('@/services/redash/dashboards', () => ({
  list: vi.fn(),
  get: vi.fn(),
  getPublic: vi.fn(),
  listAll: vi.fn(),
  listAllMy: vi.fn(),
  listAllFavorites: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  share: vi.fn(),
  unshare: vi.fn(),
}))

import type { MockDashboard } from '@/lib/mock-data'
import * as service from '@/services/redash/dashboards'
import {
  useAllDashboards,
  useCreateDashboard,
  useDashboards,
  useFavoriteDashboards,
  useForkDashboard,
  useMyDashboards,
  usePublicDashboard,
  useShareDashboard,
  useUnshareDashboard,
  useUpdateDashboard,
} from './use-dashboards'

const REFUSED = new Error('502 from Redash')

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(service.list).mockResolvedValue({ count: 0, page: 1, page_size: 25, results: [] })
  vi.mocked(service.listAll).mockResolvedValue({ count: 0, results: [], truncated: false })
  vi.mocked(service.listAllMy).mockResolvedValue({ count: 0, results: [], truncated: false })
  vi.mocked(service.listAllFavorites).mockResolvedValue({ count: 0, results: [], truncated: false })
})

describe('a refused dashboard list is not an empty one', () => {
  it('surfaces a refused library page as an error', async () => {
    vi.mocked(service.list).mockRejectedValue(REFUSED)
    const { result } = renderHook(() => useDashboards(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it('surfaces a refused my-dashboards read as an error', async () => {
    vi.mocked(service.listAllMy).mockRejectedValue(REFUSED)
    const { result } = renderHook(() => useMyDashboards(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it('surfaces a refused favorites read as an error', async () => {
    vi.mocked(service.listAllFavorites).mockRejectedValue(REFUSED)
    const { result } = renderHook(() => useFavoriteDashboards(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it('surfaces a refused whole-library read as an error', async () => {
    vi.mocked(service.listAll).mockRejectedValue(REFUSED)
    const { result } = renderHook(() => useAllDashboards(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it('reports an org with no dashboards as an empty success', async () => {
    const { result } = renderHook(() => useDashboards(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.results).toEqual([])
    expect(result.current.isError).toBe(false)
  })

  it('asks the backend to narrow the whole-library list rather than filtering after the fact', async () => {
    const { result } = renderHook(() => useAllDashboards({ search: 'rail', tags: ['bus'] }), {
      wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(vi.mocked(service.listAll)).toHaveBeenCalledWith({ search: 'rail', tags: ['bus'] })
  })
})

describe('a public dashboard read', () => {
  it('reads the board by its share token', async () => {
    vi.mocked(service.getPublic).mockResolvedValue(null)
    const { result } = renderHook(() => usePublicDashboard('tok-1'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(vi.mocked(service.getPublic)).toHaveBeenCalledWith('tok-1')
  })

  // A revoked token is a real answer, not a transport failure: the page tells
  // the reader the link no longer works rather than offering a retry.
  it('answers null for a revoked token without calling it an error', async () => {
    vi.mocked(service.getPublic).mockResolvedValue(null)
    const { result } = renderHook(() => usePublicDashboard('revoked'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
    expect(result.current.isError).toBe(false)
  })

  it('does not read anything before a token is in hand', async () => {
    const { result } = renderHook(() => usePublicDashboard(undefined), { wrapper })

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'))
    expect(result.current.status).toBe('pending')
    expect(vi.mocked(service.getPublic)).not.toHaveBeenCalled()
  })

  it('surfaces a refused public read as an error', async () => {
    vi.mocked(service.getPublic).mockRejectedValue(REFUSED)
    const { result } = renderHook(() => usePublicDashboard('tok-1'), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('forking against a real backend', () => {
  // Redash has no dashboard-fork endpoint. Failing loudly is the point: a fork
  // that resolves without creating anything sends someone looking for a copy
  // that was never made.
  it('fails loudly rather than resolving with nothing created', async () => {
    const { result } = renderHook(() => useForkDashboard(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(1).catch(() => {})
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toContain('not supported')
    expect(result.current.data).toBeUndefined()
  })
})

const BOARD: MockDashboard = {
  id: 5,
  name: 'Fleet overview',
  slug: 'fleet-overview',
  tags: [],
  is_archived: false,
  is_draft: false,
  is_favorite: false,
  can_edit: true,
  user: { id: 1, name: 'Dana', email: 'dana@example.test' },
  widgets: [],
  dashboard_filters_enabled: true,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  public_url: null,
  api_key: null,
} as MockDashboard

describe('dashboard writes against a real backend', () => {
  it('creates the board through the backend rather than inventing one locally', async () => {
    vi.mocked(service.create).mockResolvedValue(BOARD)
    const { result } = renderHook(() => useCreateDashboard(), { wrapper })

    const created = await act(async () => result.current.mutateAsync({ name: 'Fleet overview' }))

    expect(vi.mocked(service.create)).toHaveBeenCalledWith({ name: 'Fleet overview' })
    expect(created).toEqual(BOARD)
  })

  it('sends only the fields that changed on a rename', async () => {
    vi.mocked(service.update).mockResolvedValue(BOARD)
    const { result } = renderHook(() => useUpdateDashboard(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: 5, name: 'Renamed' })
    })

    expect(vi.mocked(service.update)).toHaveBeenCalledWith(5, { name: 'Renamed' })
  })

  // The expiry is the whole difference between a link that lapses and one that
  // does not, and it is the second argument, so dropping it is silent.
  it('passes the chosen expiry through to the share call', async () => {
    vi.mocked(service.share).mockResolvedValue({ public_url: 'https://x.test/p/tok', api_key: 'tok' })
    const { result } = renderHook(() => useShareDashboard(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: 5, expiresAt: '2026-08-10T00:00:00Z' })
    })

    expect(vi.mocked(service.share)).toHaveBeenCalledWith(5, '2026-08-10T00:00:00Z')
  })

  it('shares without an expiry when none was chosen', async () => {
    vi.mocked(service.share).mockResolvedValue({ public_url: 'https://x.test/p/tok', api_key: 'tok' })
    const { result } = renderHook(() => useShareDashboard(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: 5 })
    })

    expect(vi.mocked(service.share)).toHaveBeenCalledWith(5, undefined)
  })

  it('revokes the link through the backend', async () => {
    vi.mocked(service.unshare).mockResolvedValue(undefined)
    const { result } = renderHook(() => useUnshareDashboard(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(5)
    })

    expect(vi.mocked(service.unshare)).toHaveBeenCalledWith(5)
  })
})
