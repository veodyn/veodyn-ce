// One matching rule for every list search box, so "rail" finds the same rows on
// KPIs as it does on Reports.
//
// Case-insensitive substring over the fields the caller nominates. Every term
// must appear somewhere (in any field), so typing more words narrows rather
// than widens, which is what a search box that starts empty and gets typed into
// has to do to feel like it is working.

export function matchesSearch(search: string, fields: (string | null | undefined)[]): boolean {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = fields.filter(Boolean).join(' ').toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

/**
 * Narrow an already-complete page of results by a list search box.
 *
 * For the library tabs that read EVERY page (listAllMy, listAllFavorites,
 * listAllArchived), so this filter sees the whole set and is exact. It is not a
 * substitute for a server-side narrow over a paged read: filtering a window is
 * how the Discover box ended up searching only the twelve cards on screen.
 *
 * Applied through React Query's `select`, which is why the search term can stay
 * out of the query key: one cached full read, and typing filters it with no
 * refetch. `count` is recomputed so the toolbar cannot report the unfiltered
 * total beside a filtered list, which is exactly what it used to do.
 *
 * Lives here rather than beside either hook because use-dashboards re-exports
 * use-dashboard-archive, so a helper in either one would close an import cycle.
 */
// The element type is indexed off P rather than being its own inferred
// parameter: with `<T, P extends { results: T[] }>` TypeScript binds P from the
// argument and leaves T as unknown, so every caller's field accessor errored.
export function narrowPage<P extends { count: number; results: unknown[] }>(
  page: P,
  search: string | undefined,
  fields: (item: P['results'][number]) => (string | null | undefined)[]
): P {
  if (!search?.trim()) return page
  const results = page.results.filter((item) => matchesSearch(search, fields(item)))
  return { ...page, count: results.length, results }
}
