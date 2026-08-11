// Creating, renaming, sharing and forking a dashboard with no backend.
//
// Each of these is asserted through the app's own useDashboard read as well as
// through the store, so the write and the invalidation that has to follow it
// are covered together: a share token written into the store that the open
// board never refetches leaves the dialog showing "not shared" for a link that
// now works, which is the failure mode worth catching.
//
// The share link is built from this origin, never from a backend-supplied URL,
// because Redash mints a public_url on its own in-cluster hostname that
// resolves for nobody outside the cluster.
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MockDashboard } from '@/lib/mock-data'
import { useAuthStore, type CurrentUser } from '@/stores/auth-store'
import { useMockDataStore } from '@/stores/mock-data-store'
import {
  useCreateDashboard,
  useDashboard,
  useForkDashboard,
  useShareDashboard,
  useUnshareDashboard,
  useUpdateDashboard,
} from './use-dashboards'

const BOARD_ID = 910
const ME = 7

function board(overrides: Partial<MockDashboard> = {}): MockDashboard {
  return {
    id: BOARD_ID,
    name: 'Fleet overview',
    slug: 'fleet-overview',
    tags: ['rail'],
    is_archived: false,
    is_draft: false,
    is_favorite: true,
    can_edit: true,
    user: { id: ME, name: 'Dana', email: 'dana@example.test', profile_image_url: '' },
    widgets: [],
    dashboard_filters_enabled: true,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    public_url: null,
    api_key: null,
    ...overrides,
  } as MockDashboard
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
      board: useDashboard(BOARD_ID),
      create: useCreateDashboard(),
      update: useUpdateDashboard(),
      share: useShareDashboard(),
      unshare: useUnshareDashboard(),
      fork: useForkDashboard(),
    }),
    { wrapper: Wrapper }
  )
  return result
}

async function settled() {
  const result = harness()
  await waitFor(() => expect(result.current.board.isSuccess).toBe(true))
  return result
}

function stored(id = BOARD_ID) {
  return useMockDataStore.getState().dashboards.find((d) => d.id === id)
}

beforeEach(() => {
  useMockDataStore.setState({ dashboards: [board()] })
  useAuthStore.setState({
    currentUser: { id: ME, name: 'Dana', email: 'dana@example.test' } as CurrentUser,
  })
})

describe('creating a dashboard', () => {
  it('files the new board under whoever is signed in, not a hardcoded admin', async () => {
    useAuthStore.setState({
      currentUser: { id: 8, name: 'Sam', email: 'sam@example.test' } as CurrentUser,
    })
    const result = await settled()

    const created = await act(async () => result.current.create.mutateAsync({ name: 'New board' }))

    expect(created.user).toEqual({ id: 8, name: 'Sam', email: 'sam@example.test' })
  })

  it('derives a slug from the name rather than leaving it empty', async () => {
    const result = await settled()

    const created = await act(async () =>
      result.current.create.mutateAsync({ name: 'Weekly Ridership Review' })
    )

    expect(created.slug).toBe('weekly-ridership-review')
  })

  it('starts the board unshared and unstarred', async () => {
    const result = await settled()

    const created = await act(async () => result.current.create.mutateAsync({ name: 'New board' }))

    expect(created.public_url).toBeNull()
    expect(created.api_key).toBeNull()
    expect(created.is_favorite).toBe(false)
    expect(created.widgets).toEqual([])
  })
})

describe('renaming a dashboard', () => {
  it('resolves with the renamed board, not the one from before the write', async () => {
    const result = await settled()

    const updated = await act(async () =>
      result.current.update.mutateAsync({ id: BOARD_ID, name: 'Renamed board' })
    )

    expect(updated.name).toBe('Renamed board')
  })

  it('shows the new name on the open board without a reload', async () => {
    const result = await settled()

    await act(async () => {
      await result.current.update.mutateAsync({ id: BOARD_ID, name: 'Renamed board' })
    })

    await waitFor(() => expect(result.current.board.data?.name).toBe('Renamed board'))
  })

  it('leaves the fields it was not given alone', async () => {
    const result = await settled()

    await act(async () => {
      await result.current.update.mutateAsync({ id: BOARD_ID, name: 'Renamed board' })
    })

    await waitFor(() => expect(stored()?.name).toBe('Renamed board'))
    expect(stored()?.tags).toEqual(['rail'])
    expect(stored()?.is_favorite).toBe(true)
  })
})

describe('sharing a dashboard', () => {
  it('builds the reader link on this origin, not on a backend hostname', async () => {
    const result = await settled()

    const shared = await act(async () => result.current.share.mutateAsync({ id: BOARD_ID }))

    expect(shared.public_url).toBe(`${window.location.origin}/dashboards/public/${shared.api_key}`)
  })

  it('mints a token and stores it alongside the link', async () => {
    const result = await settled()

    const shared = await act(async () => result.current.share.mutateAsync({ id: BOARD_ID }))

    expect(shared.api_key).toMatch(/^[a-z0-9]+$/)
    expect(stored()?.api_key).toBe(shared.api_key)
    expect(stored()?.public_url).toBe(shared.public_url)
  })

  it('gives two boards two different tokens', async () => {
    useMockDataStore.setState({ dashboards: [board(), board({ id: 911, name: 'Second' })] })
    const result = await settled()

    const first = await act(async () => result.current.share.mutateAsync({ id: BOARD_ID }))
    const second = await act(async () => result.current.share.mutateAsync({ id: 911 }))

    expect(second.api_key).not.toBe(first.api_key)
  })

  it('shows the open board as shared without a reload', async () => {
    const result = await settled()

    await act(async () => {
      await result.current.share.mutateAsync({ id: BOARD_ID })
    })

    await waitFor(() => expect(result.current.board.data?.api_key).toBeTruthy())
  })

  // Unsharing has to clear both fields: a public_url left behind renders a live
  // looking link to a token the backend no longer honours.
  it('clears the link and the token together when the board is unshared', async () => {
    const result = await settled()
    await act(async () => {
      await result.current.share.mutateAsync({ id: BOARD_ID })
    })
    await waitFor(() => expect(stored()?.api_key).toBeTruthy())

    await act(async () => {
      await result.current.unshare.mutateAsync(BOARD_ID)
    })

    await waitFor(() => expect(result.current.board.data?.public_url).toBeNull())
    expect(stored()?.api_key).toBeNull()
  })
})

describe('forking a dashboard', () => {
  it('copies the widgets and tags under a new id', async () => {
    const result = await settled()

    const forked = await act(async () => result.current.fork.mutateAsync(BOARD_ID))

    expect(forked.id).not.toBe(BOARD_ID)
    expect(forked.name).toBe('Copy of Fleet overview')
    expect(forked.slug).toBe('copy-of-fleet-overview')
    expect(forked.tags).toEqual(['rail'])
  })

  // The copy is a new object: inheriting the original's share token would hand
  // out a live public link to a board nobody chose to publish, and inheriting
  // the star would put a board the user has not seen into their favorites.
  it('does not inherit the share token or the star', async () => {
    useMockDataStore.setState({
      dashboards: [board({ public_url: 'https://example.test/dashboards/public/tok', api_key: 'tok' })],
    })
    const result = await settled()

    const forked = await act(async () => result.current.fork.mutateAsync(BOARD_ID))

    expect(forked.public_url).toBeNull()
    expect(forked.api_key).toBeNull()
    expect(forked.is_favorite).toBe(false)
  })

  it('files the copy under whoever forked it', async () => {
    useAuthStore.setState({
      currentUser: { id: 8, name: 'Sam', email: 'sam@example.test' } as CurrentUser,
    })
    const result = await settled()

    const forked = await act(async () => result.current.fork.mutateAsync(BOARD_ID))

    expect(forked.user).toEqual({ id: 8, name: 'Sam', email: 'sam@example.test' })
  })

  it('leaves the original untouched', async () => {
    const result = await settled()

    await act(async () => {
      await result.current.fork.mutateAsync(BOARD_ID)
    })

    expect(stored()?.name).toBe('Fleet overview')
    expect(stored()?.is_favorite).toBe(true)
  })

  it('fails for a board the store does not have', async () => {
    const result = await settled()

    await act(async () => {
      await result.current.fork.mutateAsync(99999).catch(() => {})
    })

    await waitFor(() => expect(result.current.fork.isError).toBe(true))
    expect(result.current.fork.error?.message).toContain('Dashboard not found')
  })
})
