// Who sees a draft in a listing, in MOCK mode.
//
// The real list endpoint is the authority: BaseQueryListResource.get_queries
// passes include_drafts=False, and Query.all_queries then applies
// or_(is_draft == False, user_id == you). Mock mode filtered on !is_draft alone,
// which is a different predicate: it dropped the caller's own drafts, so an
// author saved a draft and watched it vanish from the list that had just
// created it. Mock mode is where this app is developed, so the disagreement was
// only ever visible against a real backend.
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { mockQueries, type MockQuery } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import { useAuthStore, type CurrentUser } from '@/stores/auth-store'
import { useAllQueries, useQueries, useCreateQuery } from './use-queries'

const ME = { id: 501, name: 'Ada', email: 'ada@example.com' }
const SOMEONE_ELSE = { id: 502, name: 'Grace', email: 'grace@example.com' }

const MINE_DRAFT = 9001
const THEIRS_DRAFT = 9002
const SHARED = 9003

function row(id: number, user: typeof ME, is_draft: boolean): MockQuery {
  return {
    ...mockQueries[0],
    id,
    name: `Query ${id}`,
    description: '',
    tags: [],
    is_archived: false,
    is_draft,
    user,
    last_modified_by: user,
  }
}

// One client for the whole test, and never revalidated. A wrapper that minted a
// client per render makes every read a cache miss, which quietly turns any
// assertion about cache KEYS into an assertion about nothing.
let client: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    currentUser: ME as unknown as CurrentUser,
  })
  useMockDataStore.setState({
    queries: [
      row(MINE_DRAFT, ME, true),
      row(THEIRS_DRAFT, SOMEONE_ELSE, true),
      row(SHARED, SOMEONE_ELSE, false),
    ],
  })
})

afterEach(() => {
  useAuthStore.setState({ currentUser: null })
  useMockDataStore.setState({ queries: mockQueries })
})

async function ids(hook: typeof useQueries | typeof useAllQueries) {
  const { result } = renderHook(() => hook(), { wrapper })
  await waitFor(() => expect(result.current.data).toBeDefined())
  return result.current.data?.results.map((q) => q.id) ?? []
}

describe('mock listings apply the same draft rule the backend does', () => {
  it('shows the caller their own draft in the query list', async () => {
    expect(await ids(useQueries)).toContain(MINE_DRAFT)
  })

  it('hides someone else’s draft from the query list', async () => {
    // The other half. Without it, "show every draft" would pass the test above.
    expect(await ids(useQueries)).not.toContain(THEIRS_DRAFT)
  })

  it('shows shared queries whoever wrote them', async () => {
    expect(await ids(useQueries)).toContain(SHARED)
  })

  it('applies the same rule to the whole-library listing', async () => {
    // /schedules and friends read this one, and a draft missing from it is a
    // schedule nobody is told about.
    const seen = await ids(useAllQueries)
    expect(seen).toContain(MINE_DRAFT)
    expect(seen).toContain(SHARED)
    expect(seen).not.toContain(THEIRS_DRAFT)
  })

  it('follows the identity switcher rather than a cached answer', async () => {
    // The rule depends on who is asking, so the cache key has to as well.
    // Keyed without the user, the first render's answer would outlive the
    // switch that changed it.
    expect(await ids(useQueries)).toContain(MINE_DRAFT)
    expect(await ids(useAllQueries)).toContain(MINE_DRAFT)

    useAuthStore.setState({ currentUser: SOMEONE_ELSE as unknown as CurrentUser })

    // Both listings, because they are keyed separately and one of them getting
    // it right says nothing about the other.
    for (const hook of [useQueries, useAllQueries]) {
      const seen = await ids(hook)
      expect(seen).toContain(THEIRS_DRAFT)
      expect(seen).not.toContain(MINE_DRAFT)
    }
  })
})

describe('mock create honours the is_draft the caller asked for', () => {
  it('creates a shared query when asked for one', async () => {
    // The service layer gets a listed query out of Redash by following the
    // create with an update. Mock mode hardcoded is_draft: true, so the same
    // call produced opposite results in the two modes.
    const { result } = renderHook(() => useCreateQuery(), { wrapper })

    const created = await result.current.mutateAsync({ query: 'select 1', is_draft: false })

    expect(created?.is_draft).toBe(false)
  })

  it('still defaults to a draft when nobody says otherwise', async () => {
    const { result } = renderHook(() => useCreateQuery(), { wrapper })

    const created = await result.current.mutateAsync({ query: 'select 1' })

    expect(created?.is_draft).toBe(true)
  })
})
