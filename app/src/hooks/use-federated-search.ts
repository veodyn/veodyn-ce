'use client'

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConfig } from '@/components/config/config-provider'
import { enabledFeatures } from '@/features'
import { federatedSearch } from '@/services/search/federated-search'
import type { SearchResultItem } from '@/services/search/types'

/**
 * Runs the federated search for `query`. TanStack supplies the queryFn signal
 * and aborts it when the key changes, so a superseded search cancels its
 * in-flight fetch. Disabled for an empty term.
 */
export function useFederatedSearch(
  query: string,
  /** Optional tag facet. A tag with no term is a valid search on its own. */
  tag?: string
): UseQueryResult<SearchResultItem[]> {
  const registry = enabledFeatures(useConfig())
  return useQuery({
    queryKey: ['search', query, tag ?? ''],
    queryFn: ({ signal }) => federatedSearch(query, { signal, tag: tag || undefined, registry }),
    enabled: query.trim().length > 0 || Boolean(tag),
  })
}
