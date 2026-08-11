'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { USE_REAL_API } from '@/services/redash/config'
import { withFixtureFallback } from '@/lib/backend-fallback'
import { useMockDataStore } from '@/stores/mock-data-store'
import { fetchFeeds, setFeedAlert, setFeedExpectation } from '@/services/catalog/client'

export function useFeeds() {
  const feeds = useMockDataStore((s) => s.feeds)
  return useQuery({
    queryKey: ['feeds'],
    // Feeds ride on the catalog contract, which 503s until CATALOG_API_URL is
    // set. Fall back to fixtures instead of showing an empty freshness board.
    queryFn: async ({ signal }) =>
      USE_REAL_API ? withFixtureFallback(() => fetchFeeds({ signal }), () => feeds) : feeds,
  })
}

/**
 * Declare how often a feed should deliver.
 *
 * In mock mode the store carries the change, so the board behaves the same way
 * without a backend: the label recomputes and deriveFeedStatus starts aging the
 * feed, which is the whole observable effect.
 */
export function useSetFeedExpectation() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (vars: { feedId: string; seconds: number | null }) => {
      if (USE_REAL_API) {
        await setFeedExpectation(vars.feedId, vars.seconds)
        return
      }
      store.setFeedExpectation(vars.feedId, vars.seconds)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feeds'] }),
  })
}

/** Arm or disarm the derived late-alert on a feed. */
export function useSetFeedAlert() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (vars: { feedId: string; armed: boolean }) => {
      if (USE_REAL_API) {
        await setFeedAlert(vars.feedId, vars.armed)
        return
      }
      store.setFeedAlert(vars.feedId, vars.armed)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feeds'] }),
  })
}
