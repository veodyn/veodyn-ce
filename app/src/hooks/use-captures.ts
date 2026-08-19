'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { USE_REAL_API } from '@/services/redash/config'
import { withFixtureFallback } from '@/lib/backend-fallback'
import { useMockDataStore } from '@/stores/mock-data-store'
import { fetchCaptures, setCaptureAlert, setCaptureExpectation } from '@/services/catalog/client'

export function useCaptures() {
  const captures = useMockDataStore((s) => s.captures)
  return useQuery({
    queryKey: ['captures'],
    // Captures ride on the catalog contract, which 503s until CATALOG_API_URL
    // is set. Fall back to fixtures instead of showing an empty freshness board.
    queryFn: async ({ signal }) =>
      USE_REAL_API ? withFixtureFallback(() => fetchCaptures({ signal }), () => captures) : captures,
  })
}

/**
 * Declare how often a capture should deliver.
 *
 * In mock mode the store carries the change, so the board behaves the same way
 * without a backend: the label recomputes and deriveCaptureStatus starts aging
 * the capture, which is the whole observable effect.
 */
export function useSetCaptureExpectation() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (vars: { captureId: string; seconds: number | null }) => {
      if (USE_REAL_API) {
        await setCaptureExpectation(vars.captureId, vars.seconds)
        return
      }
      store.setCaptureExpectation(vars.captureId, vars.seconds)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['captures'] }),
  })
}

/** Arm or disarm the derived late-alert on a capture. */
export function useSetCaptureAlert() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (vars: { captureId: string; armed: boolean }) => {
      if (USE_REAL_API) {
        await setCaptureAlert(vars.captureId, vars.armed)
        return
      }
      store.setCaptureAlert(vars.captureId, vars.armed)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['captures'] }),
  })
}
