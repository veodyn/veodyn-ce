// The search page keeps q and type in the URL, so every link that changes
// either one is built here. Shared by the tabs, the "Show all" links, and the
// client shell's shallow URL sync.
import { featureSearchTypes, type FeatureSearchType } from '@/features'
import { CORE_SEARCH_SOURCE_TYPES, type SearchSourceType } from '@/services/search/types'

export type SearchTab = SearchSourceType | 'all'

/**
 * The tab list for a build whose registry contributes `searchTypes`: All,
 * then the core types, then the contributed ones, matching grouping.ts's
 * ordering so the tabs and the grouped result headings never disagree about
 * type order.
 *
 * The contributed types are a parameter defaulting to the real registry seam,
 * exactly as `countByType` and `groupResults` take theirs. What the list holds
 * is a fact about which packages a build installs, so a test that wants the
 * core-only answer states the registry it means rather than depending on the
 * tree it happens to run in.
 */
export function searchTabs(searchTypes: FeatureSearchType[] = featureSearchTypes()): SearchTab[] {
  return ['all', ...CORE_SEARCH_SOURCE_TYPES, ...searchTypes.map((searchType) => searchType.type)]
}

export const SEARCH_TABS: SearchTab[] = searchTabs()

export function searchHref(query: string, tab: SearchTab, tag?: string): string {
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  if (tab !== 'all') params.set('type', tab)
  if (tag) params.set('tag', tag)
  const qs = params.toString()
  return qs ? `/search?${qs}` : '/search'
}

/**
 * Where a tag chip points. A `tag` facet rather than `q=<tag>`: as a search
 * term it would also match everything that merely mentions the word, and would
 * miss anything tagged but not named for it.
 */
export function tagHref(tag: string): string {
  return searchHref('', 'all', tag)
}

/** A repeated ?tag takes the first, matching how ?q and ?type are read. */
export function firstTag(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
  return value.trim()
}

/** A repeated or unrecognized ?type falls back to the All tab. */
export function normalizeTab(raw: string | string[] | undefined): SearchTab {
  const value = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
  return (SEARCH_TABS as readonly string[]).includes(value) ? value : 'all'
}
