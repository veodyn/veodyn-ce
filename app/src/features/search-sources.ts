// The registry seam for federated search.
//
// The sources a search runs against are assembled here from the community
// sources (services/search/sources.ts, still the community half of the answer)
// plus whatever the installed features contribute.
//
// Two properties this module holds:
//
//   - It is NOT re-exported from src/features/index.ts, which the server root
//     layout reaches through src/lib/theme-preference.ts. This module imports
//     the community sources, which import the service clients, so re-exporting
//     it would drag all of that onto every route's pre-paint path.
//   - One feature's absence does not blank the search. A contributor whose
//     loader rejects costs that feature's results and nothing else, the same
//     way federatedSearch treats a source that answers badly.
import { AppError, ErrorIds } from '@/lib/errorIds'
import { SEARCH_SOURCES } from '@/services/search/sources'
import type { SearchSource } from '@/services/search/types'
import { FEATURES } from './generated-registry'
import { featureList } from './index'
import type { FeatureDescriptor, SearchSourceFactory } from './types'

type SearchContributor = FeatureDescriptor & { searchSource: SearchSourceFactory }

/**
 * Resolved sources, keyed by the registry object they were assembled from.
 *
 * A search runs on every keystroke in the palette, so re-entering the loaders
 * per call would be wrong. A single module-level array would be worse than no
 * cache at all: whichever caller ran first would decide what every later one
 * sees, and a test resolving a stub registry would answer for the real one.
 * Keying on registry identity gives the shipped FEATURES a stable entry and
 * each stub its own, with no reset hook for a test to remember to call.
 */
const resolved = new WeakMap<Record<string, FeatureDescriptor>, Promise<SearchSource[]>>()

function contributorsIn(registry: Record<string, FeatureDescriptor>): SearchContributor[] {
  return featureList(registry).filter(
    (feature): feature is SearchContributor => feature.searchSource !== undefined
  )
}

/**
 * Every contributed source that loaded, plus whether any failed to. The flag
 * is what stops a failure from being cached: see assembleSearchSources.
 */
async function loadContributions(
  registry: Record<string, FeatureDescriptor>
): Promise<{ sources: SearchSource[]; failed: boolean }> {
  const contributors = contributorsIn(registry)
  const settled = await Promise.allSettled(contributors.map((feature) => feature.searchSource()))

  const sources: SearchSource[] = []
  let failed = false
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      sources.push(result.value)
      return
    }
    failed = true
    const error = new AppError(
      ErrorIds.SEARCH_SOURCE_UNAVAILABLE,
      "A feature's search source could not be loaded and was skipped",
      { feature: contributors[index].id, reason: String(result.reason) }
    )
    console.error(error.toLogLine())
  })
  return { sources, failed }
}

/**
 * The sources this build's federated search should query: the community ones
 * first, then one per installed feature that contributes a search source, in
 * featureList() order so the grouping on /search and in the palette does not
 * reshuffle between builds or between keystrokes.
 *
 * Takes the registry as an optional final parameter, so a caller can exercise
 * the empty-registry path for real instead of mocking this module.
 */
export function assembleSearchSources(
  registry: Record<string, FeatureDescriptor> = FEATURES
): Promise<SearchSource[]> {
  const cached = resolved.get(registry)
  if (cached) return cached

  const assembling = loadContributions(registry).then(({ sources, failed }) => {
    // A failed load is not cached, or one unreachable chunk would leave a
    // feature missing from search until the tab is reloaded. Dropping the entry
    // costs one retry per search while the loader keeps failing.
    if (failed) resolved.delete(registry)
    return [...SEARCH_SOURCES, ...sources]
  })
  resolved.set(registry, assembling)
  return assembling
}
