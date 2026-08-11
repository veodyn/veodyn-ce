'use client'

import { useQuery } from '@tanstack/react-query'
import { useShallow } from 'zustand/react/shallow'
import { USE_REAL_API } from '@/services/redash/config'
import { useMockDataStore } from '@/stores/mock-data-store'
import { storeCollections } from '@/stores/mock-data-hydration'
import { countTags, mergeTagCounts, type TagSuggestion } from '@/lib/tags'
import * as tagsService from '@/services/tags/client'

// The vocabulary is global rather than per entity type, on purpose: tagging a
// report `rail` should suggest the `rail` already sitting on twelve queries.
// A per-type vocabulary would defeat cross-entity pivoting, which is the point.

/**
 * A stale suggestion list is harmless (the worst case is a tag added a minute
 * ago not being offered yet), and this is fetched on every detail page, so it
 * is cached hard.
 */
const STALE_TIME = 10 * 60 * 1000

/** Stable identity so the placeholder does not re-render every consumer. */
const EMPTY: TagSuggestion[] = []

/**
 * Three independent backends, so `allSettled` rather than `all`: one of them
 * being down degrades the suggestion list, it does not take tagging out. The
 * query itself never rejects, which is what "failure is non-fatal" means here.
 */
async function fetchMergedVocabulary(signal?: AbortSignal): Promise<TagSuggestion[]> {
  const settled = await Promise.allSettled([
    tagsService.fetchRedashTagVocabulary('queries', { signal }),
    tagsService.fetchRedashTagVocabulary('dashboards', { signal }),
    tagsService.fetchTagVocabulary({ signal }),
  ])
  return mergeTagCounts(settled.map((r) => (r.status === 'fulfilled' ? r.value : EMPTY)))
}

export function useTagVocabulary() {
  // Mock mode derives the same shape from the fixtures, so the suggestion list
  // is populated while developing without a backend.
  //
  // EVERY collection, not a list of the five that happened to be taggable when
  // this was written. `countTags` already ignores a row with no `tags` array,
  // which is what made naming them unnecessary, and naming them meant a
  // community hook reading `s.kpis` and `s.reports`: two collections that do
  // not exist in a build with no KPI or report feature. A collection whose rows
  // start carrying tags is now counted without this file being edited.
  const collections = useMockDataStore(useShallow(storeCollections))

  return useQuery({
    queryKey: ['tag-vocabulary'],
    staleTime: STALE_TIME,
    placeholderData: EMPTY,
    queryFn: async ({ signal }) =>
      USE_REAL_API ? fetchMergedVocabulary(signal) : mergeTagCounts(collections.map(countTags)),
  })
}
