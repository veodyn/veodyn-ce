'use client'

// Archiving a dashboard and putting it back, split out of use-dashboards.ts
// when the two halves together outgrew the file size limit. Re-exported from
// use-dashboards.ts, which stays the single import path every call site uses,
// so this seam is invisible to callers.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMockDataStore } from '@/stores/mock-data-store'
import { USE_REAL_API } from '@/services/redash/config'
import * as dashboardsService from '@/services/redash/dashboards'
import { narrowPage } from '@/lib/list-filter'

/**
 * Archive a dashboard.
 *
 * Named for what it does, not for the verb on the wire. Redash's DELETE on a
 * dashboard calls `Dashboard.archive`, so there is no hard delete to offer and
 * the old name (`useDeleteDashboard`) promised one.
 */
export function useArchiveDashboard() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (id: number) => {
      if (USE_REAL_API) {
        return dashboardsService.archive(id)
      }
      store.updateDashboard(id, { is_archived: true })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  })
}

/**
 * Every archived dashboard, paged through like the other tabs.
 *
 * No other listing returns these: `Dashboard.all` filters `is_archived` out, so
 * the Archive tab is the only place an archived dashboard is reachable from,
 * and restoring is the only thing to do with it.
 */
export function useArchivedDashboards(params?: { search?: string }) {
  const search = params?.search
  const store = useMockDataStore()
  return useQuery({
    queryKey: ['dashboards', 'archive'],
    queryFn: () => {
      if (USE_REAL_API) {
        return dashboardsService.listAllArchived()
      }
      const results = store.dashboards.filter((d) => d.is_archived)
      return { count: results.length, results, truncated: false }
    },
    select: (page) => narrowPage(page, search, (d) => [d.name]),
  })
}

/**
 * Restore an archived dashboard.
 *
 * There is no companion "delete permanently": Redash's DELETE on a dashboard
 * is what archived this one, and it exposes no hard delete at all.
 */
export function useUnarchiveDashboard() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (id: number) => {
      if (USE_REAL_API) {
        return dashboardsService.unarchive(id)
      }
      store.updateDashboard(id, { is_archived: false })
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['dashboards'] })
      qc.invalidateQueries({ queryKey: ['dashboard', id] })
    },
  })
}
