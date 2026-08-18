// One matching rule for every list search box, so "rail" finds the same rows on
// KPIs as it does on Reports. Case-insensitive substring over the fields the
// caller nominates, and every term must appear somewhere, so typing more words
// narrows rather than widens.

export function matchesSearch(search: string, fields: (string | null | undefined)[]): boolean {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = fields.filter(Boolean).join(' ').toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

/**
 * Narrow an already-complete page of results by a list search box.
 *
 * Only for the library tabs that read EVERY page (listAllMy, listAllFavorites,
 * listAllArchived), so this filter sees the whole set. It is not a substitute
 * for a server-side narrow over a paged read.
 *
 * Applied through React Query's `select`, so the search term stays out of the
 * query key: one cached full read, filtered with no refetch. `count` is
 * recomputed so the toolbar cannot report the unfiltered total.
 *
 * Lives here rather than beside either hook because use-dashboards re-exports
 * use-dashboard-archive, so a helper in either one would close an import cycle.
 */
// The element type is indexed off P rather than being its own inferred
// parameter: with `<T, P extends { results: T[] }>` TypeScript binds P from the
// argument and leaves T as unknown, so every caller's field accessor errors.
export function narrowPage<P extends { count: number; results: unknown[] }>(
  page: P,
  search: string | undefined,
  fields: (item: P['results'][number]) => (string | null | undefined)[]
): P {
  if (!search?.trim()) return page
  const results = page.results.filter((item) => matchesSearch(search, fields(item)))
  return { ...page, count: results.length, results }
}
