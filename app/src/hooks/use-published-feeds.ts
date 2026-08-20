'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { USE_REAL_API } from '@/services/redash/config'
import { withFixtureFallback } from '@/lib/backend-fallback'
import { useMockDataStore } from '@/stores/mock-data-store'
import * as queriesService from '@/services/redash/queries'
import { getResult } from '@/services/redash/execution'
import {
  createPublishedFeed,
  deletePublishedFeed,
  fetchAttempts,
  fetchFeedCapabilities,
  fetchPublishedFeed,
  fetchPublishedFeeds,
  publishNow,
  updatePublishedFeed,
} from '@/services/published-feeds/client'
import type { FeedCapabilities, PublishAttempt, PublishedFeed, PublishedFeedInput } from '@/types/published-feed'

const LIST_KEY = ['published-feeds']
const CAPABILITIES_KEY = ['published-feeds', 'capabilities']
const feedKey = (slug: string) => ['published-feeds', slug]
const attemptsKey = (slug: string) => ['published-feeds', slug, 'attempts']

// Community's own registry, exactly as services/published_feed_registry.py seeds it:
// one gtfs-rt entity, both gbfs shapes, and each standard's own supported
// versions. What a real fixture-mode session returns when there is no backend to
// ask. Mock mode is what pnpm test:e2e runs on, so gtfs-rt must show its entity
// as a fact rather than an empty picker, while gbfs genuinely offers a choice of
// shape and of version.
//
// `timezones` is the one field a fixture cannot mirror: the real answer is the
// 597-name enum the API reads out of the validator's schema, so this carries a
// sample and the picker offers fewer names here than a wired session does.
const MOCK_CAPABILITIES: FeedCapabilities = {
  standards: [
    {
      standard: 'gbfs',
      versions: ['2.3', '3.0'],
      entities: ['stations', 'vehicles'],
      timezones: ['America/Los_Angeles', 'America/New_York', 'Europe/Berlin', 'Europe/London', 'UTC'],
    },
    { standard: 'gtfs-rt', versions: ['2.0'], entities: ['vehicle_positions'], timezones: [] },
  ],
}

export interface QueryResultColumns {
  /** Redash's own result id, so a later read can tell whether it has moved on. */
  resultId: number | null
  columns: string[]
}

export function usePublishedFeeds() {
  const feeds = useMockDataStore((s) => s.publishedFeeds)
  return useQuery({
    queryKey: LIST_KEY,
    // The sidecar 503s until its URL is set, which is the agreed "not wired
    // yet" signal. Only a 503 falls back; a 4xx or 5xx from a configured
    // backend is a real failure and must surface.
    queryFn: async ({ signal }) =>
      USE_REAL_API ? withFixtureFallback(() => fetchPublishedFeeds({ signal }), () => feeds) : feeds,
  })
}

export function usePublishedFeed(slug: string | undefined) {
  const feeds = useMockDataStore((s) => s.publishedFeeds)
  return useQuery({
    queryKey: feedKey(slug ?? ''),
    enabled: slug != null,
    queryFn: async ({ signal }): Promise<PublishedFeed | null> => {
      const fixture = () => feeds.find((f) => f.slug === slug) ?? null
      if (!USE_REAL_API) return fixture()
      return withFixtureFallback(() => fetchPublishedFeed(slug as string, { signal }), fixture)
    },
  })
}

/**
 * What this deployment's entity registry holds. Any org member may read it,
 * matching the API's own gate: it names what a build can bind a feed to, not
 * who may read one.
 *
 * Same 503-falls-back-to-fixture rule as the other feed hooks: only "not
 * wired yet" degrades, a real 4xx or 5xx surfaces as an error the form's
 * loading-or-failed branch treats identically to still-loading.
 */
export function useFeedCapabilities() {
  return useQuery({
    queryKey: CAPABILITIES_KEY,
    queryFn: async ({ signal }): Promise<FeedCapabilities> =>
      USE_REAL_API
        ? withFixtureFallback(() => fetchFeedCapabilities({ signal }), () => MOCK_CAPABILITIES)
        : MOCK_CAPABILITIES,
  })
}

export function useAttempts(slug: string | undefined) {
  const attempts = useMockDataStore((s) => s.publishAttempts)
  return useQuery({
    queryKey: attemptsKey(slug ?? ''),
    enabled: slug != null,
    queryFn: async ({ signal }): Promise<PublishAttempt[]> => {
      const fixture = () => attempts[slug as string] ?? []
      if (!USE_REAL_API) return fixture()
      return withFixtureFallback(() => fetchAttempts(slug as string, { signal }), fixture)
    },
  })
}

export function useCreatePublishedFeed() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (input: PublishedFeedInput) =>
      USE_REAL_API ? createPublishedFeed(input) : store.createPublishedFeed(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  })
}

export function useUpdatePublishedFeed() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (vars: { slug: string; input: PublishedFeedInput }) =>
      USE_REAL_API
        ? updatePublishedFeed(vars.slug, vars.input)
        : store.updatePublishedFeed(vars.slug, vars.input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: LIST_KEY })
      qc.invalidateQueries({ queryKey: feedKey(vars.slug) })
      // The edit cleared the served pointer, so the history on screen is stale
      // in the one way that matters: it still shows something as serving.
      qc.invalidateQueries({ queryKey: attemptsKey(vars.slug) })
    },
  })
}

export function useDeletePublishedFeed() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (slug: string) =>
      USE_REAL_API ? deletePublishedFeed(slug) : store.deletePublishedFeed(slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  })
}

/**
 * The bound query's latest result columns, read through the existing Redash
 * passthrough rather than a new backend endpoint: the query for
 * `latest_query_data_id`, then that result for `data.columns[].name`.
 *
 * Returns the result id alongside the columns, not just the columns: a later
 * screen (the publish-now guard) needs it to compare against the artifact
 * currently serving, and reading it twice through two hooks would be two
 * reads of the same Redash pair.
 */
export function useQueryResultColumns(queryId: number | undefined) {
  const queries = useMockDataStore((s) => s.queries)
  const queryResults = useMockDataStore((s) => s.queryResults)
  return useQuery({
    queryKey: ['published-feeds', 'query-result-columns', queryId],
    enabled: queryId !== undefined,
    queryFn: async (): Promise<QueryResultColumns> => {
      if (!USE_REAL_API) {
        const query = queries.find((q) => q.id === queryId)
        const resultId = query?.latest_query_data_id ?? null
        const columns = resultId != null ? (queryResults[resultId]?.data.columns.map((c) => c.name) ?? []) : []
        return { resultId, columns }
      }
      const query = await queriesService.get(queryId as number)
      const resultId = query?.latest_query_data_id ?? null
      if (resultId == null) return { resultId: null, columns: [] }
      const result = await getResult(resultId)
      return { resultId, columns: result.data.columns.map((c) => c.name) }
    },
  })
}

export function usePublishNow() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (slug: string) => (USE_REAL_API ? publishNow(slug) : store.recordPublishAttempt(slug)),
    onSuccess: (_data, slug) => qc.invalidateQueries({ queryKey: attemptsKey(slug) }),
  })
}
