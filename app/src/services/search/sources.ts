// The community federation sources: queries, dashboards and catalog datasets.
// Every source branches on USE_REAL_API exactly like the useQueries /
// useDashboards hooks: mock mode reads the in-memory store, real mode calls the
// entity client (which routes through the same-origin proxy).
//
// A feature's own source does NOT live here. The KPI and report sources sit
// beside their clients, in services/kpi/search-source.ts and
// services/report/search-source.ts, and reach federated search through their
// descriptors' deferred `searchSource` loaders. That is what lets a build
// without those directories still type-check this file. The two helpers they
// share with the sources below, hasTag and nothingAsked, are exported for
// exactly that: one answer per question, across every source.
import { USE_REAL_API } from '@/services/redash/config'
import * as queriesService from '@/services/redash/queries'
import * as dashboardsService from '@/services/redash/dashboards'
import * as catalogService from '@/services/catalog/client'
import { useMockDataStore } from '@/stores/mock-data-store'
import type { MockQuery, MockDashboard } from '@/lib/mock-data'
import type { Dataset } from '@/types/catalog'
import type { SearchResultItem, SearchSource } from './types'

/**
 * Tag matching, shared so every source agrees on it.
 *
 * Exact, including case, because that is what the backend does: Redash filters
 * with `cast(column, ARRAY(Text)).contains(tags)` (redash/handlers/base.py,
 * filter_by_tags), which is case-sensitive array containment. Matching
 * case-insensitively here would mean ?tag=rail found a query tagged "Rail" in
 * mock mode and in the catalog, but not in the queries and dashboards a real
 * Redash answers for. Exact also means "rail" never matches "rail-history": a
 * tag is an identifier, not a prefix.
 *
 * Chips pass the stored string through verbatim, so this is the case that
 * actually occurs; only a hand-edited URL can miss, and it misses everywhere.
 */
export function hasTag(tags: string[] | undefined, tag: string): boolean {
  return (tags ?? []).includes(tag)
}

/**
 * A tag facet with no search term is a valid search ("show me everything tagged
 * X"), so emptiness is judged on both together.
 *
 * Exported for the feature sources, which are not in this file but must give
 * the same answer: a source that short-circuits on a different condition makes
 * the same search return a different set depending on which sources ran.
 */
export function nothingAsked(query: string, tag: string | undefined): boolean {
  return !query.trim() && !tag
}

export function queryToResult(q: MockQuery): SearchResultItem {
  return {
    id: `query-${q.id}`,
    type: 'query',
    title: q.name,
    subtitle: q.description || undefined,
    href: `/queries/${q.id}`,
    updatedAt: q.updated_at,
  }
}

export function dashboardToResult(d: MockDashboard): SearchResultItem {
  return {
    id: `dashboard-${d.id}`,
    type: 'dashboard',
    title: d.name,
    href: `/dashboards/${d.id}`,
    updatedAt: d.updated_at,
  }
}

const queriesSource: SearchSource = {
  type: 'query',
  label: 'Queries',
  async search(query, { signal, tag }) {
    if (nothingAsked(query, tag)) return []
    if (USE_REAL_API) {
      // Redash filters by tag server-side, so a tag search does not depend on
      // whatever happens to be on the first page of results.
      const page = await queriesService.search(query, {
        signal,
        tags: tag ? [tag] : undefined,
      })
      return page.results.map(queryToResult)
    }
    const needle = query.toLowerCase()
    return useMockDataStore
      .getState()
      // Archived is excluded, drafts are not, which is what the backend does:
      // Query.all_queries filters is_archived and the queries handler passes
      // include_drafts=True on both its branches. Hiding drafts here made the
      // same search return different queries in mock mode and against a real
      // Redash, so local testing could not show what stage would do. The
      // queries list page does not hide them either.
      .queries.filter(
        (q) =>
          !q.is_archived &&
          (!tag || hasTag(q.tags, tag)) &&
          (!needle ||
            q.name.toLowerCase().includes(needle) ||
            q.description.toLowerCase().includes(needle))
      )
      .map(queryToResult)
  },
}

const dashboardsSource: SearchSource = {
  type: 'dashboard',
  label: 'Dashboards',
  async search(query, { signal, tag }) {
    if (nothingAsked(query, tag)) return []
    if (USE_REAL_API) {
      const page = await dashboardsService.search(query, {
        signal,
        tags: tag ? [tag] : undefined,
      })
      return page.results.map(dashboardToResult)
    }
    const needle = query.toLowerCase()
    return useMockDataStore
      .getState()
      .dashboards.filter(
        (d) =>
          !d.is_archived &&
          (!tag || hasTag(d.tags, tag)) &&
          (!needle || d.name.toLowerCase().includes(needle))
      )
      .map(dashboardToResult)
  },
}

export function datasetToResult(d: Dataset): SearchResultItem {
  return {
    id: `catalog-${d.id}`,
    type: 'catalog',
    title: d.name,
    subtitle: d.description || undefined,
    href: `/data/dataset/${d.id}`,
    updatedAt: d.freshness.lastUpdatedAt,
  }
}

const catalogSource: SearchSource = {
  type: 'catalog',
  label: 'Datasets',
  async search(query, { signal, tag }) {
    if (nothingAsked(query, tag)) return []
    if (USE_REAL_API) {
      // /api/catalog takes no tag parameter, so a tag facet is applied here.
      // The q is dropped when filtering by tag, or the endpoint would narrow to
      // name matches before the tag filter ever saw the rest.
      const datasets = await catalogService.fetchCatalog({
        q: tag ? undefined : query,
        signal,
      })
      const tagged = tag ? datasets.filter((d) => hasTag(d.tags, tag)) : datasets
      const needle = query.trim().toLowerCase()
      return tagged
        .filter(
          (d) =>
            !needle ||
            d.name.toLowerCase().includes(needle) ||
            d.description.toLowerCase().includes(needle)
        )
        .map(datasetToResult)
    }
    const needle = query.toLowerCase()
    return useMockDataStore
      .getState()
      .datasets.filter(
        (d) =>
          (!tag || hasTag(d.tags, tag)) &&
          (!needle ||
            d.name.toLowerCase().includes(needle) ||
            d.description.toLowerCase().includes(needle))
      )
      .map(datasetToResult)
  },
}

/**
 * The community sources, and only those. What a search actually queries is
 * assembled in features/search-sources.ts, which appends one source per
 * installed feature that contributes a `searchSource` factory: in a tree with
 * the KPI and report features present that is this list plus those two.
 *
 * Do not add a feature's source here. A static import of its client is what
 * this array stopped doing, and it is what a community build cannot compile.
 */
export const SEARCH_SOURCES: SearchSource[] = [queriesSource, dashboardsSource, catalogSource]
