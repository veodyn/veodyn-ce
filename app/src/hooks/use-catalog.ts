'use client'

import { useQuery } from '@tanstack/react-query'
import { USE_REAL_API } from '@/services/redash/config'
import { withFixtureFallback } from '@/lib/backend-fallback'
import { useMockDataStore } from '@/stores/mock-data-store'
import * as catalogService from '@/services/catalog/client'

// CATALOG_API_URL is configured separately from Redash. When it is unset the
// contract answers 503 and these surfaces fall back to fixtures rather than
// rendering empty against a backend that does not exist.

export function useCatalog() {
  const datasets = useMockDataStore((s) => s.datasets)
  return useQuery({
    queryKey: ['catalog'],
    queryFn: async ({ signal }) =>
      USE_REAL_API
        ? withFixtureFallback(() => catalogService.fetchCatalog({ signal }), () => datasets)
        : datasets,
  })
}

export function useDataset(id: string) {
  const datasets = useMockDataStore((s) => s.datasets)
  const find = () => datasets.find((d) => d.id === id) ?? null
  return useQuery({
    queryKey: ['catalog', id],
    queryFn: async ({ signal }) =>
      USE_REAL_API
        ? withFixtureFallback(() => catalogService.fetchDataset(id, { signal }), find)
        : find(),
  })
}

export function useDomainHubs() {
  const hubs = useMockDataStore((s) => s.domainHubs)
  return useQuery({
    queryKey: ['domains'],
    queryFn: async ({ signal }) =>
      USE_REAL_API
        ? withFixtureFallback(() => catalogService.fetchDomainHubs({ signal }), () => hubs)
        : hubs,
  })
}

export function useDomainHub(key: string) {
  const hubs = useMockDataStore((s) => s.domainHubs)
  const find = () => hubs.find((h) => h.key === key) ?? null
  return useQuery({
    queryKey: ['domain', key],
    queryFn: async ({ signal }) =>
      USE_REAL_API
        ? withFixtureFallback(() => catalogService.fetchDomainHub(key, { signal }), find)
        : find(),
  })
}
