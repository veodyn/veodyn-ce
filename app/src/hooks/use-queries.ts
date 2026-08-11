'use client'

import { useQuery } from '@tanstack/react-query'
import { useMockDataStore } from '@/stores/mock-data-store'
import { useAuthStore } from '@/stores/auth-store'
import { USE_REAL_API } from '@/services/redash/config'
import * as queriesService from '@/services/redash/queries'
import type { MockQuery } from '@/lib/mock-data'
import { narrowPage } from '@/lib/list-filter'
import { required } from '@/lib/required'

// The write half lives next door, re-exported here so that
// `@/hooks/use-queries` stays the one import path for anything query-shaped.
// The split is a file size limit, not a boundary callers should have to know.
export * from './use-query-mutations'

/**
 * Does a mock row belong in a shared listing?
 *
 * Mirrors the backend rather than approximating it.
 * `BaseQueryListResource.get_queries` passes `include_drafts=False`, and
 * `Query.all_queries` then applies `or_(is_draft == False, user_id == you)`, so
 * a draft is listed for its author and for nobody else. Filtering on
 * `!is_draft` alone dropped the caller's own drafts, which is the one case the
 * real list does return, and mock mode is where this app is developed.
 */
function isListedFor(query: MockQuery, currentUserId: number | undefined): boolean {
  return !query.is_draft || query.user.id === currentUserId
}

export function useQueries(params?: { page?: number; search?: string; tags?: string[] }) {
  const store = useMockDataStore()
  // In the cache key as well as the filter: who is signed in decides which
  // drafts belong in the list, so a page cached under the previous identity
  // would outlive the switch that changed the answer.
  const currentUserId = useAuthStore((s) => s.currentUser?.id)
  return useQuery({
    queryKey: ['queries', params, currentUserId],
    queryFn: () => {
      if (USE_REAL_API) {
        return queriesService.list(params)
      }
      let results = store.queries.filter((q) => !q.is_archived && isListedFor(q, currentUserId))
      if (params?.search) {
        const s = params.search.toLowerCase()
        results = results.filter(
          (q) => q.name.toLowerCase().includes(s) || q.description.toLowerCase().includes(s)
        )
      }
      const tags = params?.tags
      if (tags?.length) {
        results = results.filter((q) => tags.some((t) => q.tags.includes(t)))
      }
      return { count: results.length, page: params?.page ?? 1, page_size: 25, results }
    },
  })
}

/**
 * The My / Favorites / Archive tabs all take the same optional `search`.
 *
 * They used not to. Only `useAllQueries` accepted a term, so on three of four
 * tabs the box took input, showed a clear button and changed nothing, while the
 * count beside it kept reporting the unfiltered total. These three read every
 * page, so `narrowPage` filters the complete set through `select` rather than
 * re-requesting: exact, and free as you type.
 */
export function useMyQueries(params?: { search?: string }) {
  const search = params?.search
  const store = useMockDataStore()
  // Whoever the identity switcher currently points at, not a hardcoded 1.
  // "My queries" labelled with another user's rows is worse than an empty
  // list, and the switcher exists precisely to view the app as someone else.
  const currentUserId = useAuthStore((s) => s.currentUser?.id)
  return useQuery({
    queryKey: ['queries', 'my', currentUserId],
    queryFn: () => {
      // Every page. The profile and the My tab both render the whole set with
      // no pagination, so stopping at the first 25 would drop the rest with
      // nothing on screen saying so.
      if (USE_REAL_API) {
        return queriesService.listAllMy()
      }
      const results = store.queries.filter(
        (q) => q.user.id === currentUserId && !q.is_archived
      )
      // truncated is part of the shape in both modes, so a caller can ask
      // without narrowing a union that only sometimes carries the field.
      return { count: results.length, results, truncated: false }
    },
    select: (page) => narrowPage(page, search, (q) => [q.name, q.description]),
  })
}

export function useFavoriteQueries(params?: { search?: string }) {
  const search = params?.search
  const store = useMockDataStore()
  return useQuery({
    queryKey: ['queries', 'favorites', 'all'],
    queryFn: () => {
      // Every page, not the first 25. This feeds the Favorites screen, which
      // shows a complete set rather than paging, so a 26th starred query
      // vanishing would be silent.
      if (USE_REAL_API) {
        return queriesService.listAllFavorites()
      }
      const results = store.queries.filter((q) => q.is_favorite && !q.is_archived)
      return { count: results.length, results, truncated: false }
    },
    select: (page) => narrowPage(page, search, (q) => [q.name, q.description]),
  })
}

/**
 * Every non-archived query in the instance, paged through.
 *
 * Two kinds of caller, same need. The screens that reason about the whole
 * library rather than showing a page of it: /schedules filters to the scheduled
 * ones, counts them and judges whether each is late, and all three answers are
 * wrong if it can only see the first 25 rows. And the library list itself,
 * which pages in the browser so that sorting and the row count describe the
 * whole set rather than whichever 25 rows the server sent first.
 *
 * `search` and `tags` still narrow server-side, so a specific search is one
 * request rather than a full read.
 */
export function useAllQueries(params?: { search?: string; tags?: string[] }) {
  const store = useMockDataStore()
  const currentUserId = useAuthStore((s) => s.currentUser?.id)
  const search = params?.search
  const tags = params?.tags
  return useQuery({
    queryKey: ['queries', 'all', search, tags, currentUserId],
    queryFn: () => {
      if (USE_REAL_API) {
        return queriesService.listAll({ search, tags })
      }
      let results = store.queries.filter((q) => !q.is_archived && isListedFor(q, currentUserId))
      if (search) {
        const needle = search.toLowerCase()
        results = results.filter(
          (q) =>
            q.name.toLowerCase().includes(needle) ||
            q.description.toLowerCase().includes(needle)
        )
      }
      if (tags?.length) {
        results = results.filter((q) => tags.some((t) => q.tags.includes(t)))
      }
      return { count: results.length, results, truncated: false }
    },
  })
}

export function useArchivedQueries(params?: { search?: string }) {
  const search = params?.search
  const store = useMockDataStore()
  return useQuery({
    queryKey: ['queries', 'archive'],
    queryFn: () => {
      // Every page, like the other tabs. A single server page left anything
      // archived before the most recent 25 with no way back: unarchiving is
      // reachable only from this list.
      if (USE_REAL_API) {
        return queriesService.listAllArchived()
      }
      const results = store.queries.filter((q) => q.is_archived)
      return { count: results.length, results, truncated: false }
    },
    select: (page) => narrowPage(page, search, (q) => [q.name, q.description]),
  })
}

export function useQueryById(id: number | undefined) {
  const store = useMockDataStore()
  return useQuery({
    queryKey: ['query', id],
    queryFn: () => {
      if (USE_REAL_API) {
        return queriesService.get(required(id, 'the query id'))
      }
      return store.queries.find((q) => q.id === id) ?? null
    },
    enabled: id !== undefined,
  })
}

export function useRecentQueries() {
  const store = useMockDataStore()
  return useQuery({
    queryKey: ['queries', 'recent'],
    queryFn: () => {
      if (USE_REAL_API) {
        return queriesService.listRecent()
      }
      const results = [...store.queries]
        .filter((q) => !q.is_archived)
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 20)
      return { count: results.length, results }
    },
  })
}
