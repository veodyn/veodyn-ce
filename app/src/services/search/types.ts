// Normalized federation types. One SearchResultItem shape spans every source so
// the palette and the /search page render a single, uniform list.
//
// The CE source types are a closed literal tuple so the label and noun maps
// below keep compile-time exhaustiveness. Registry-contributed types (kpi,
// report, and anything M2 adds) are not known to the type system, so
// SearchSourceType itself is a plain string and every lookup on it returns
// `| undefined`. Widening the tuple to include registry strings would have
// degraded these maps to Record<string, ...>, which lets a missing label
// compile silently. See docs/superpowers/plans/2026-08-07-ee-1-registry-seam.md.
import { featureSearchTypes, type FeatureSearchType } from '@/features'

export const CORE_SEARCH_SOURCE_TYPES = ['query', 'dashboard', 'catalog'] as const

export type CoreSearchSourceType = (typeof CORE_SEARCH_SOURCE_TYPES)[number]

/**
 * Any type this build's search can return: the three core types plus
 * whatever the registry contributes. A plain string, deliberately: the
 * registry is not known to the type system, so nothing here can promise
 * exhaustiveness over it.
 */
export type SearchSourceType = string

function isCoreSearchSourceType(type: string): type is CoreSearchSourceType {
  return (CORE_SEARCH_SOURCE_TYPES as readonly string[]).includes(type)
}

export interface SearchResultItem {
  /** Namespaced across types to avoid id collisions, e.g. "query-7". */
  id: string
  type: SearchSourceType
  title: string
  subtitle?: string
  /** Same-origin app route to navigate to on select. */
  href: string
  updatedAt?: string
}

export interface SearchSourceContext {
  /** Threaded to the underlying fetch so a superseded search aborts. */
  signal?: AbortSignal
  /**
   * Restrict to items carrying this tag. A facet, not a search term: matching
   * the tag as free text would also return everything that merely mentions the
   * word, and would miss nothing tagged but unnamed.
   *
   * Every source answers it: queries and dashboards through Redash's own
   * server-side tag filter, datasets, KPIs and reports against the tags
   * veodyn-api stores for them. A source must never ignore the facet and
   * report unrelated matches as tagged.
   */
  tag?: string
}

export interface SearchSource {
  type: SearchSourceType
  label: string
  search: (query: string, ctx: SearchSourceContext) => Promise<SearchResultItem[]>
}

export const CORE_SEARCH_TYPE_LABELS: Record<CoreSearchSourceType, string> = {
  query: 'Queries',
  dashboard: 'Dashboards',
  catalog: 'Datasets',
}

/**
 * The same labels as they read mid-sentence, for copy like
 * `No {noun} match "bikes"`.
 *
 * Spelled out rather than derived with `.toLowerCase()`, which turned KPIs into
 * "kpis" in the one empty state that used it. An acronym has no lowercase form,
 * so there is nothing here for a transform to get right.
 */
export const CORE_SEARCH_TYPE_NOUNS: Record<CoreSearchSourceType, string> = {
  query: 'queries',
  dashboard: 'dashboards',
  catalog: 'datasets',
}

/**
 * A type's display label, whether it is a core CE type or a registry-
 * contributed one. Undefined for a type nothing in this build claims: a
 * caller must handle that honestly rather than asserting it away.
 *
 * The contributed types are a parameter defaulting to the real registry seam,
 * the same shape `countByType` and `searchTabs` take. Which types resolve is a
 * fact about which packages a build installs, so a test states the registry it
 * is asking about instead of inheriting the tree it runs in.
 */
export function searchTypeLabel(
  type: string,
  searchTypes: FeatureSearchType[] = featureSearchTypes()
): string | undefined {
  if (isCoreSearchSourceType(type)) return CORE_SEARCH_TYPE_LABELS[type]
  return searchTypes.find((searchType) => searchType.type === type)?.label
}

/** Same composition as searchTypeLabel, for the mid-sentence noun form. */
export function searchTypeNoun(
  type: string,
  searchTypes: FeatureSearchType[] = featureSearchTypes()
): string | undefined {
  if (isCoreSearchSourceType(type)) return CORE_SEARCH_TYPE_NOUNS[type]
  return searchTypes.find((searchType) => searchType.type === type)?.noun
}
