'use client'

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMockDataStore } from '@/stores/mock-data-store'
import { USE_REAL_API } from '@/services/redash/config'
import * as execution from '@/services/redash/execution'
import type { MockDashboardWidget } from '@/lib/mock-data'
import { required } from '@/lib/required'

/**
 * Resolve the data behind a dashboard visualization widget.
 *
 * Real mode uses the three-tier strategy (cheapest first):
 *   1. inline result shipped with the dashboard payload
 *   2. stored result via latest_query_data_id (single GET, no execution)
 *   3. POST queries/:id/results with max_age OMITTED — Redash returns
 *      whatever cached result it has, or spawns a job only if none exists.
 * Explicit refresh forces max_age: 0 (fresh execution) — see `refresh` below.
 */
export function useWidgetData(
  widget: MockDashboardWidget,
  parameters: Record<string, unknown> = {}
) {
  const store = useMockDataStore()
  const queryClient = useQueryClient()
  const viz = widget.visualization
  const queryId = viz?.query.id
  // A parameterised widget is really one cache entry per set of values: two
  // widgets on the same dashboard can share a query and differ only by what
  // they were given, and a key blind to that serves one of them the other's
  // rows.
  const queryKey = ['widget-data', widget.id, queryId, parameters]
  // Only a query that declares parameters can vary, so this is also what keeps
  // the tiered strategy below for everything that cannot.
  const isParameterised = (viz?.query.options?.parameters?.length ?? 0) > 0

  const query = useQuery({
    queryKey,
    enabled: !!viz,
    queryFn: async () => {
      if (!USE_REAL_API) {
        const q = store.queries.find((q) => q.id === queryId)
        if (!q?.latest_query_data_id) return null
        return store.queryResults[q.latest_query_data_id] ?? null
      }

      // Bound once, so the three tiers below read one visualization rather
      // than re-asserting on each line that `enabled` kept this from running
      // without one.
      const source = required(viz, 'the widget visualization')

      // Both cheap tiers are skipped for a parameterised query: each returns
      // whatever was last computed, which is the result for some other set of
      // values, so reusing it means changing a filter and getting the previous
      // filter's rows. Executing instead is not wasteful, because Redash caches
      // on the rendered query text and identical values still hit that cache.
      if (!isParameterised) {
        // Tier 1 — inline result from the dashboard payload
        const inline = source.query.latest_query_data
        if (inline?.data?.rows?.length) {
          return inline
        }

        // Tier 2 — stored result by id
        if (source.query.latest_query_data_id != null) {
          try {
            return await execution.getResult(source.query.latest_query_data_id)
          } catch {
            // stale pointer — fall through to execute
          }
        }
      }

      // Tier 3 — execute accepting any cached result (max_age omitted)
      try {
        return await execution.executeSavedQuery(source.query.id, { parameters })
      } catch {
        return null
      }
    },
  })

  // Additive, opt-in: forces a fresh execution (max_age: 0) only when
  // explicitly invoked (e.g. a widget's refresh button). Does not change the
  // tiered default-load strategy above.
  const refetch = query.refetch
  const refresh = useCallback(async () => {
    if (!viz || !USE_REAL_API) {
      await refetch()
      return
    }
    const result = await execution.executeSavedQuery(viz.query.id, { maxAge: 0, parameters })
    queryClient.setQueryData(['widget-data', widget.id, queryId, parameters], result)
  }, [viz, queryClient, widget.id, queryId, refetch, parameters])

  return { ...query, refresh }
}
