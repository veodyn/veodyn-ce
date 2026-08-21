'use client'

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useMockDataStore } from '@/stores/mock-data-store'
import { USE_REAL_API } from '@/services/redash/config'
import * as vizService from '@/services/redash/visualizations'
import { AppError, ErrorIds } from '@/lib/errorIds'
import type { MockVisualization } from '@/lib/mock-data'

// Minting an embed link needs a backend that can serve it. Mock mode has none,
// so the mutation refuses rather than handing back a token that resolves to a
// dead page; the dialog says so before the user clicks, and this is the guard
// behind that.
function requireBackend(action: string): never {
  throw new AppError(
    ErrorIds.CFG_ENV_MISSING,
    `${action} needs a connected Redash backend.`,
    { action }
  )
}

/**
 * The cache entries a visualization mutation makes stale.
 *
 * `['queries']` is the list prefix, and it is not enough: a visualization is only
 * ever reached through the query that owns it, and the query editor's tab strip
 * reads from `useQueryById`, keyed `['query', id]`. That singular key does not
 * match the plural prefix, so invalidating the lists alone left the editor
 * serving the visualizations it had already fetched. Against the real backend
 * that made Save look like a dead button: the POST landed and the tab never
 * appeared. In mock mode the same gap hid a new visualization until a full
 * page reload, which for the in-memory store would have dropped it again.
 */
function invalidateOwningQuery(qc: QueryClient, queryId: number) {
  qc.invalidateQueries({ queryKey: ['queries'] })
  qc.invalidateQueries({ queryKey: ['query', queryId] })
}

export function useCreateVisualization() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async ({
      queryId,
      ...vizData
    }: Partial<MockVisualization> & { queryId: number }) => {
      if (USE_REAL_API) {
        return vizService.createVisualization({
          query_id: queryId,
          type: vizData.type || 'TABLE',
          name: vizData.name || 'New Visualization',
          description: vizData.description || '',
          options: vizData.options || {},
        }) as Promise<MockVisualization>
      }
      const query = store.queries.find((q) => q.id === queryId)
      if (!query) throw new Error('Query not found')
      const now = new Date().toISOString()
      const viz: MockVisualization = {
        id: Date.now(),
        type: vizData.type || 'TABLE',
        name: vizData.name || 'New Visualization',
        description: vizData.description || '',
        options: vizData.options || {},
        created_at: now,
        updated_at: now,
      }
      store.updateQuery(queryId, {
        visualizations: [...query.visualizations, viz],
      })
      return viz
    },
    onSuccess: (_created, { queryId }) => invalidateOwningQuery(qc, queryId),
  })
}

export function useUpdateVisualization() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async ({
      queryId,
      vizId,
      ...updates
    }: Partial<MockVisualization> & { queryId: number; vizId: number }) => {
      if (USE_REAL_API) {
        await vizService.updateVisualization(vizId, {
          type: updates.type,
          name: updates.name,
          description: updates.description,
          options: updates.options,
        })
        return
      }
      const query = store.queries.find((q) => q.id === queryId)
      if (!query) throw new Error('Query not found')
      store.updateQuery(queryId, {
        visualizations: query.visualizations.map((v) =>
          v.id === vizId ? { ...v, ...updates, updated_at: new Date().toISOString() } : v
        ),
      })
      // A dashboard widget holds its own copy of the visualization, because that
      // is how Redash serializes it (serialize_widget -> serialize_visualization).
      // Real mode gets the edit for free: the copy is built from the row that
      // just changed. The mock store has two independent copies, so without this
      // an edit made from a dashboard widget saved, invalidated, refetched the
      // fixture, and drew exactly what it drew before.
      for (const dashboard of store.dashboards) {
        if (!dashboard.widgets.some((w) => w.visualization?.id === vizId)) continue
        store.updateDashboard(dashboard.id, {
          widgets: dashboard.widgets.map((w) =>
            w.visualization?.id === vizId
              ? { ...w, visualization: { ...w.visualization, ...updates } }
              : w
          ),
        })
      }
    },
    onSuccess: (_updated, { queryId }) => {
      invalidateOwningQuery(qc, queryId)
      // Every cached dashboard, not just the one in front of the editor: the
      // options that changed are drawn by every widget pointing at this
      // visualization, and `['dashboard']` as a prefix covers each `['dashboard',
      // id]` entry. The widget's DATA is untouched, so `['widget-data']` is
      // deliberately left alone; re-running every query on a dashboard because
      // someone recoloured a chart would be a warehouse bill, not a refresh.
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['dashboards'] })
    },
  })
}

/**
 * Mint an embed share token for one visualization.
 *
 * Does not invalidate the owning query: the token comes back in the response
 * and the dialog holds it, because Redash's visualization serializer does not
 * carry it and a refetch would therefore lose it again.
 */
export function useShareVisualization() {
  return useMutation({
    mutationFn: async ({
      vizId,
      expiresAt,
    }: {
      vizId: number
      expiresAt?: string | null
    }) => {
      if (!USE_REAL_API) requireBackend('Creating an embed link')
      return vizService.shareVisualization(vizId, expiresAt)
    },
  })
}

export function useUnshareVisualization() {
  return useMutation({
    mutationFn: async (vizId: number) => {
      if (!USE_REAL_API) requireBackend('Revoking an embed link')
      return vizService.unshareVisualization(vizId)
    },
  })
}

/**
 * The anonymous read behind /embed/public/[token].
 *
 * `retry: false` because every refusal upstream is a 404 by design: a dead link
 * does not become live on the second attempt, and retrying only delays the one
 * message the reader is going to get.
 */
export function usePublicVisualization(
  token: string | null,
  opts: {
    /**
     * Refetch cadence for a page that stays open unattended (a wall screen's
     * webview). Null or absent means fetch once, which is what a link pasted
     * into a chat deserves. The interval re-reads the query's LATEST STORED
     * result; it never runs the query, so the cadence worth setting is the
     * query's own schedule, and this only picks up what that schedule wrote.
     */
    refetchIntervalMs?: number | null
  } = {}
) {
  return useQuery({
    queryKey: ['public-visualization', token],
    enabled: !!token,
    retry: false,
    refetchInterval: opts.refetchIntervalMs ?? false,
    queryFn: ({ signal }) =>
      token ? vizService.fetchPublicVisualization(token, { signal }) : null,
  })
}

export function useDeleteVisualization() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async ({ queryId, vizId }: { queryId: number; vizId: number }) => {
      if (USE_REAL_API) {
        return vizService.deleteVisualization(vizId)
      }
      const query = store.queries.find((q) => q.id === queryId)
      if (!query) throw new Error('Query not found')
      store.updateQuery(queryId, {
        visualizations: query.visualizations.filter((v) => v.id !== vizId),
      })
    },
    onSuccess: (_deleted, { queryId }) => invalidateOwningQuery(qc, queryId),
  })
}
