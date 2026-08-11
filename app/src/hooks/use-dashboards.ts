'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMockDataStore } from '@/stores/mock-data-store'
import { useAuthStore } from '@/stores/auth-store'
import { mockOwner } from '@/lib/mock-owner'
import { dashboardPublicPath, publicLinkUrl } from '@/lib/public-links'
import { USE_REAL_API } from '@/services/redash/config'
import * as dashboardsService from '@/services/redash/dashboards'
import type { MockDashboard } from '@/lib/mock-data'
import { narrowPage } from '@/lib/list-filter'
import { required } from '@/lib/required'

export function useDashboards(params?: { page?: number; search?: string; tags?: string[] }) {
  const store = useMockDataStore()
  return useQuery({
    queryKey: ['dashboards', params],
    queryFn: () => {
      if (USE_REAL_API) {
        return dashboardsService.list(params)
      }
      let results = store.dashboards.filter((d) => !d.is_archived)
      if (params?.search) {
        const s = params.search.toLowerCase()
        results = results.filter((d) => d.name.toLowerCase().includes(s))
      }
      const tags = params?.tags
      if (tags?.length) {
        results = results.filter((d) => tags.some((t) => d.tags.includes(t)))
      }
      return { count: results.length, page: params?.page ?? 1, page_size: 25, results }
    },
  })
}

export function useDashboard(id: number | undefined) {
  const store = useMockDataStore()
  return useQuery({
    queryKey: ['dashboard', id],
    queryFn: () => {
      if (USE_REAL_API) {
        return dashboardsService.get(required(id, 'the dashboard id'))
      }
      return store.dashboards.find((d) => d.id === id) ?? null
    },
    enabled: id !== undefined,
  })
}

export function usePublicDashboard(token: string | undefined) {
  return useQuery({
    queryKey: ['dashboard', 'public', token],
    queryFn: () => dashboardsService.getPublic(required(token, 'the public dashboard token')),
    enabled: USE_REAL_API && token !== undefined,
  })
}

/**
 * The My / Favorites / Archive tabs all take the same optional `search`, for
 * the reason spelled out over `useMyQueries`: the box used to do nothing on
 * three of four tabs.
 *
 * Dashboards match on name alone, which is what `useAllDashboards` already does
 * server-side. Matching more fields here than the All tab matches there would
 * make the same term mean different things on different tabs.
 */
export function useMyDashboards(params?: { search?: string }) {
  const search = params?.search
  const store = useMockDataStore()
  // Whoever the identity switcher currently points at, not a hardcoded 1.
  // "My dashboards" labelled with another user's rows is worse than an empty
  // list, and the switcher exists precisely to view the app as someone else.
  const currentUserId = useAuthStore((s) => s.currentUser?.id)
  return useQuery({
    queryKey: ['dashboards', 'my', currentUserId],
    queryFn: () => {
      // Every page, for the same reason as queries: rendered in full, never
      // paged.
      if (USE_REAL_API) {
        return dashboardsService.listAllMy()
      }
      const results = store.dashboards.filter(
        (d) => d.user.id === currentUserId && !d.is_archived
      )
      // truncated is part of the shape in both modes, so a caller can ask
      // without narrowing a union that only sometimes carries the field.
      return { count: results.length, results, truncated: false }
    },
    select: (page) => narrowPage(page, search, (d) => [d.name]),
  })
}

export function useFavoriteDashboards(params?: { search?: string }) {
  const search = params?.search
  const store = useMockDataStore()
  return useQuery({
    queryKey: ['dashboards', 'favorites', 'all'],
    queryFn: () => {
      // Every page: the Favorites screen shows a complete set, not a page.
      if (USE_REAL_API) {
        return dashboardsService.listAllFavorites()
      }
      const results = store.dashboards.filter((d) => d.is_favorite && !d.is_archived)
      return { count: results.length, results, truncated: false }
    },
    select: (page) => narrowPage(page, search, (d) => [d.name]),
  })
}

/**
 * Every dashboard, not just the first server page.
 *
 * What the library list uses, so that sorting and the row count describe the
 * whole set: ItemsTable sorts before it slices, and handing it 25 of 300 rows
 * would make "sort by name" quietly mean "sort this page by name". `search` and
 * `tags` still narrow server-side, so a specific search stays one request.
 */
export function useAllDashboards(params?: { search?: string; tags?: string[] }) {
  const store = useMockDataStore()
  const search = params?.search
  const tags = params?.tags
  return useQuery({
    queryKey: ['dashboards', 'all', search, tags],
    queryFn: () => {
      if (USE_REAL_API) {
        return dashboardsService.listAll({ search, tags })
      }
      let results = store.dashboards.filter((d) => !d.is_archived)
      if (search) {
        const needle = search.toLowerCase()
        results = results.filter((d) => d.name.toLowerCase().includes(needle))
      }
      if (tags?.length) {
        results = results.filter((d) => tags.some((t) => d.tags.includes(t)))
      }
      return { count: results.length, results, truncated: false }
    },
  })
}

export function useCreateDashboard() {
  const owner = mockOwner(useAuthStore((s) => s.currentUser))
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (data: { name: string }) => {
      if (USE_REAL_API) {
        return dashboardsService.create(data)
      }
      const id = store.nextId('dashboards')
      const now = new Date().toISOString()
      const dashboard: MockDashboard = {
        id,
        name: data.name,
        slug: data.name.toLowerCase().replace(/\s+/g, '-'),
        tags: [],
        is_archived: false,
        is_draft: false,
        is_favorite: false,
        can_edit: true,
        user: owner,
        widgets: [],
        dashboard_filters_enabled: true,
        created_at: now,
        updated_at: now,
        public_url: null,
        api_key: null,
      }
      store.addDashboard(dashboard)
      return dashboard
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  })
}

export function useUpdateDashboard() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<MockDashboard> & { id: number }) => {
      if (USE_REAL_API) {
        return dashboardsService.update(id, updates)
      }
      store.updateDashboard(id, { ...updates, updated_at: new Date().toISOString() })
      return required(
        useMockDataStore.getState().dashboards.find((d) => d.id === id),
        'the updated dashboard'
      )
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['dashboards'] })
      qc.invalidateQueries({ queryKey: ['dashboard', vars.id] })
    },
  })
}

// Archive, the archived listing and restore live next door so this file stays
// under the size limit. Re-exported here because '@/hooks/use-dashboards' is
// the import path every dashboard call site already uses.
export {
  useArchiveDashboard,
  useArchivedDashboards,
  useUnarchiveDashboard,
} from './use-dashboard-archive'

export function useShareDashboard() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    // An object rather than a bare id, because sharing now carries a second
    // answer (how long for) and a positional second argument would be the kind
    // of call nobody can read at the site.
    mutationFn: async ({ id, expiresAt }: { id: number; expiresAt?: string | null }) => {
      if (USE_REAL_API) {
        return dashboardsService.share(id, expiresAt)
      }
      const token = Math.random().toString(36).slice(2, 14)
      const public_url = publicLinkUrl(dashboardPublicPath(token))
      store.updateDashboard(id, { public_url, api_key: token })
      return { public_url, api_key: token }
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['dashboards'] })
      qc.invalidateQueries({ queryKey: ['dashboard', id] })
    },
  })
}

export function useUnshareDashboard() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (id: number) => {
      if (USE_REAL_API) {
        return dashboardsService.unshare(id)
      }
      store.updateDashboard(id, { public_url: null, api_key: null })
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['dashboards'] })
      qc.invalidateQueries({ queryKey: ['dashboard', id] })
    },
  })
}

export function useForkDashboard() {
  const owner = mockOwner(useAuthStore((s) => s.currentUser))
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (id: number) => {
      if (USE_REAL_API) {
        // node has no dashboard-fork endpoint; composing one client-side
        // (create + re-POST widgets) is a follow-up if the UI ever needs it.
        throw new Error('Dashboard fork is not supported with a real query service')
      }
      const original = store.dashboards.find((d) => d.id === id)
      if (!original) throw new Error('Dashboard not found')
      const newId = store.nextId('dashboards')
      const now = new Date().toISOString()
      const forked: MockDashboard = {
        ...original,
        id: newId,
        name: `Copy of ${original.name}`,
        slug: `copy-of-${original.slug}`,
        is_favorite: false,
        user: owner,
        created_at: now,
        updated_at: now,
        public_url: null,
        api_key: null,
      }
      store.addDashboard(forked)
      return forked
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  })
}
