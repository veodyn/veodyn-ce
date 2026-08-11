// The three tag rules every surface shares: what is reserved, how a typed tag
// is normalized, and how a vocabulary is merged.
//
// `services/search/sources.ts` deliberately keeps its own `hasTag`: that is a
// matching rule against tags already stored (exact, case sensitive, mirroring
// Redash's array containment), not a normalization rule for tags being written.

/**
 * Tags under this prefix drive domain hubs: `veodyn-api` builds a hub by
 * scanning `domain:`-prefixed tags on queries and dashboards. They are hidden
 * from every chip list rather than shown, because an editable chip with an X on
 * it would let a person delete a hub by accident.
 */
export const RESERVED_PREFIX = 'domain:'

/** One entry of a tag vocabulary. Same shape Redash's tag endpoints return. */
export interface TagSuggestion {
  name: string
  count: number
}

/**
 * Trim, collapse inner whitespace, lowercase. Applied to what a person types,
 * never to tags already stored: matching is exact and case sensitive, so
 * rewriting existing tags would change other people's saved searches.
 */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Exact prefix match, on purpose. This is the same test the backend's hub
 * scanner makes, so `isReserved` and "is a hub tag" cannot drift apart. A typed
 * `Domain:rail` is still refused, because callers normalize before asking.
 */
export function isReserved(tag: string): boolean {
  return tag.startsWith(RESERVED_PREFIX)
}

/** The tags a person may see and remove: everything the hubs do not own. */
export function visibleTags(tags: string[]): string[] {
  return tags.filter((tag) => !isReserved(tag))
}

/**
 * A tag on its way to being stored, carrying where it came from.
 *
 * The two cases have to stay apart all the way to the write, because they get
 * opposite treatment: `vocabulary` is a name that already exists somewhere and
 * must be joined exactly as it is spelled, `typed` is free text that has never
 * been stored and is normalized so it cannot become a near-duplicate.
 */
export type TagCandidate =
  /** Activated from the suggestion listbox, spelled by the vocabulary. */
  | { source: 'vocabulary'; value: string }
  /** Free text, including the "create <tag>" row, which is typed text too. */
  | { source: 'typed'; value: string }

/**
 * Decide the string that actually gets stored for a candidate.
 *
 * Normalizing a vocabulary pick is the bug this exists to prevent: matching is
 * exact and case sensitive (`services/search/sources.ts`), so rewriting a
 * picked `Rail` to `rail` writes a second, unrelated tag and the object drops
 * out of the list its own chip links to. Spec decision 5 is that mixed-case
 * tags already stored stay pickable verbatim; spec decision 3 is that new text
 * is normalized. This is where those two meet.
 */
export function resolveTagCandidate(candidate: TagCandidate): string {
  if (candidate.source === 'vocabulary') {
    // Verbatim, but still nothing when the vocabulary hands over a blank name:
    // a tag made of spaces is not a tag whichever end it arrived from.
    return normalizeTag(candidate.value) ? candidate.value : ''
  }
  return normalizeTag(candidate.value)
}

/**
 * Fold several vocabularies into one. Counts sum when a name appears in more
 * than one source, because a tag on eight queries and four reports is one tag
 * used twelve times. Reserved tags are dropped so they can never be suggested.
 *
 * Sorted by count descending then name ascending, matching the order the
 * backends already return, so the suggestion list is stable between renders.
 */
export function mergeTagCounts(sources: TagSuggestion[][]): TagSuggestion[] {
  const counts = new Map<string, number>()
  for (const source of sources) {
    for (const { name, count } of source) {
      if (!name || isReserved(name)) continue
      counts.set(name, (counts.get(name) ?? 0) + (Number.isFinite(count) ? count : 0))
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/**
 * Count the tags carried by a list of objects into vocabulary shape.
 *
 * The item type is deliberately loose: mock mode counts across queries,
 * dashboards, datasets, KPIs and reports, which are five unrelated types whose
 * only shared feature is an optional `tags` array.
 */
export function countTags(items: readonly unknown[]): TagSuggestion[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    const tags = (item as { tags?: unknown })?.tags
    if (!Array.isArray(tags)) continue
    for (const tag of tags) {
      if (typeof tag !== 'string' || !tag) continue
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }))
}
