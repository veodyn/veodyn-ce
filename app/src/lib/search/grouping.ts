// Pure grouping and counting over an already-fetched federated result set.
// federatedSearch queries every source on each search, so narrowing by type is
// a client-side filter and per-type counts are free.
import { featureSearchTypes, type FeatureSearchType } from '@/features'
import {
  CORE_SEARCH_SOURCE_TYPES,
  type SearchResultItem,
  type SearchSourceType,
} from '@/services/search/types'

/** Rows shown per type on the All tab before "Show all" takes over. */
export const GROUP_CAP = 5

/**
 * Every type this build's search can return, core types first then whatever
 * the registry contributes, in stable order. Grouping and counting iterate
 * this rather than the result set's own order, so groups do not reshuffle
 * when a source happens to answer first.
 */
function searchTypeOrder(searchTypes: FeatureSearchType[]): string[] {
  return [...CORE_SEARCH_SOURCE_TYPES, ...searchTypes.map((searchType) => searchType.type)]
}

/**
 * A count per type. A plain string-keyed record, honestly: it is built by
 * iterating a runtime list (searchTypeOrder), not a closed compile-time union.
 */
export type SearchTypeCounts = Record<string, number>

export interface SearchGroup {
  type: SearchSourceType
  /** Already capped for display. */
  items: SearchResultItem[]
  /** Count before capping, so "Show all N" reports the real total. */
  total: number
  truncated: boolean
}

export function countByType(
  results: SearchResultItem[],
  // The registry-contributed types as an explicit input, defaulting to the
  // real registry seam. Tests pass an explicitly empty array to prove the
  // core-only case without mocking @/features.
  searchTypes: FeatureSearchType[] = featureSearchTypes()
): SearchTypeCounts {
  const counts = Object.fromEntries(
    searchTypeOrder(searchTypes).map((type) => [type, 0])
  ) as SearchTypeCounts
  for (const item of results) counts[item.type] = (counts[item.type] ?? 0) + 1
  return counts
}

export function capGroup(
  type: SearchSourceType,
  items: SearchResultItem[],
  cap: number = GROUP_CAP
): SearchGroup {
  return {
    type,
    items: items.slice(0, cap),
    total: items.length,
    truncated: items.length > cap,
  }
}

export function groupResults(
  results: SearchResultItem[],
  cap: number = GROUP_CAP,
  searchTypes: FeatureSearchType[] = featureSearchTypes()
): SearchGroup[] {
  const buckets = new Map<string, SearchResultItem[]>()
  for (const item of results) {
    const bucket = buckets.get(item.type) ?? []
    bucket.push(item)
    buckets.set(item.type, bucket)
  }

  // Iterate the canonical type order rather than insertion order so groups do
  // not reshuffle when a source happens to return first.
  return searchTypeOrder(searchTypes)
    .filter((type) => (buckets.get(type)?.length ?? 0) > 0)
    .map((type) => capGroup(type, buckets.get(type) ?? [], cap))
}
