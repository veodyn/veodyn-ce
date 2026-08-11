// The five dashboard lists, with no backend.
//
// They differ in which rows they include and in nothing else, so the subject
// here is exclusion: archived boards out of every list, other people's boards
// out of "my", unstarred boards out of "favorites". Each of those is one
// predicate in one filter, and getting one wrong shows a plausible list that is
// quietly the wrong set.
//
// "My" follows the identity switcher rather than a hardcoded id, so the current
// user is part of the setup and part of the cache key.
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MockDashboard } from '@/lib/mock-data'
import { useAuthStore, type CurrentUser } from '@/stores/auth-store'
import { useMockDataStore } from '@/stores/mock-data-store'
import {
  useAllDashboards,
  useDashboards,
  useFavoriteDashboards,
  useMyDashboards,
} from './use-dashboards'

const ME = 7
const SOMEONE_ELSE = 8

function board(id: number, name: string, overrides: Partial<MockDashboard> = {}): MockDashboard {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    tags: [],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
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

const MINE = board(1, 'Fleet overview', { tags: ['rail'] })
const THEIRS = board(2, 'Air quality', {
  user: { id: SOMEONE_ELSE, name: 'Sam', email: 'sam@example.test' },
  tags: ['air'],
})
const STARRED = board(3, 'Ridership', { is_favorite: true, tags: ['rail'] })
const ARCHIVED = board(4, 'Old board', { is_archived: true, is_favorite: true })

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

function names(data: { results: MockDashboard[] } | undefined) {
  return data?.results.map((d) => d.name)
}

beforeEach(() => {
  useMockDataStore.setState({ dashboards: [MINE, THEIRS, STARRED, ARCHIVED] })
  useAuthStore.setState({
    currentUser: { id: ME, name: 'Dana', email: 'dana@example.test' } as CurrentUser,
  })
})

describe('the paged library list', () => {
  it('leaves archived boards out', async () => {
    const { result } = renderHook(() => useDashboards(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(names(result.current.data)).toEqual(['Fleet overview', 'Air quality', 'Ridership'])
    expect(result.current.data?.count).toBe(3)
  })

  it('matches a search without regard to case', async () => {
    const { result } = renderHook(() => useDashboards({ search: 'FLEET' }), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(names(result.current.data)).toEqual(['Fleet overview'])
  })

  // Any of the tags, not all of them: the tag filter is a set of things to
  // include, and requiring every one of them would empty the list as soon as a
  // second tag was ticked.
  it('keeps a board that carries any one of the chosen tags', async () => {
    const { result } = renderHook(() => useDashboards({ tags: ['rail', 'air'] }), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(names(result.current.data)).toEqual(['Fleet overview', 'Air quality', 'Ridership'])
  })

  it('narrows to the one board carrying a single chosen tag', async () => {
    const { result } = renderHook(() => useDashboards({ tags: ['air'] }), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(names(result.current.data)).toEqual(['Air quality'])
  })

  it('reports a search that matches nothing as an empty success, not an error', async () => {
    const { result } = renderHook(() => useDashboards({ search: 'nothing matches this' }), {
      wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(names(result.current.data)).toEqual([])
    expect(result.current.isError).toBe(false)
  })

  it('echoes back the page it was asked for', async () => {
    const { result } = renderHook(() => useDashboards({ page: 3 }), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.page).toBe(3)
  })
})

describe('my dashboards', () => {
  // A "my dashboards" list showing someone else's boards is worse than an empty
  // one, and the identity switcher exists precisely so this is exercised.
  it('shows only the boards belonging to the signed-in user', async () => {
    const { result } = renderHook(() => useMyDashboards(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(names(result.current.data)).toEqual(['Fleet overview', 'Ridership'])
  })

  it('follows the identity switcher instead of a hardcoded user', async () => {
    useAuthStore.setState({
      currentUser: { id: SOMEONE_ELSE, name: 'Sam', email: 'sam@example.test' } as CurrentUser,
    })
    const { result } = renderHook(() => useMyDashboards(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(names(result.current.data)).toEqual(['Air quality'])
  })

  it('keeps one cache entry per user, so switching identity does not show the previous list', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    }
    const first = renderHook(() => useMyDashboards(), { wrapper: Wrapper })
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))

    useAuthStore.setState({
      currentUser: { id: SOMEONE_ELSE, name: 'Sam', email: 'sam@example.test' } as CurrentUser,
    })
    const second = renderHook(() => useMyDashboards(), { wrapper: Wrapper })

    await waitFor(() => expect(names(second.result.current.data)).toEqual(['Air quality']))
  })

  it('leaves an archived board of mine out', async () => {
    useMockDataStore.setState({ dashboards: [board(5, 'Retired', { is_archived: true })] })
    const { result } = renderHook(() => useMyDashboards(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(names(result.current.data)).toEqual([])
  })

  // `truncated` is part of the shape in both modes so a caller can read it
  // without narrowing a union that only sometimes carries the field.
  it('reports the set as complete rather than leaving truncated undefined', async () => {
    const { result } = renderHook(() => useMyDashboards(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.truncated).toBe(false)
  })
})

describe('favorites and the whole library', () => {
  it('shows starred boards whoever owns them', async () => {
    const { result } = renderHook(() => useFavoriteDashboards(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(names(result.current.data)).toEqual(['Ridership'])
  })

  // A starred board that was archived belongs in Archived, not in Favorites:
  // it is not something to open, and it would be the only route to it.
  it('leaves a starred board out of favorites once it is archived', async () => {
    const { result } = renderHook(() => useFavoriteDashboards(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(names(result.current.data)).not.toContain('Old board')
  })

  it('returns every unarchived board, not one page of them', async () => {
    const { result } = renderHook(() => useAllDashboards(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(names(result.current.data)).toEqual(['Fleet overview', 'Air quality', 'Ridership'])
    expect(result.current.data?.truncated).toBe(false)
  })

  it('still narrows the whole-library list by search and by tag', async () => {
    const bySearch = renderHook(() => useAllDashboards({ search: 'ridership' }), { wrapper })
    const byTag = renderHook(() => useAllDashboards({ tags: ['air'] }), { wrapper })

    await waitFor(() => expect(names(bySearch.result.current.data)).toEqual(['Ridership']))
    await waitFor(() => expect(names(byTag.result.current.data)).toEqual(['Air quality']))
  })
})
