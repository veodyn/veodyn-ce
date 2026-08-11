import { afterEach, describe, expect, it } from 'vitest'
import {
  SEARCH_SOURCES,
  dashboardToResult,
  datasetToResult,
  queryToResult,
} from '@/services/search/sources'
import { useMockDataStore } from '@/stores/mock-data-store'
import { makeDashboard, makeDataset, makeQuery } from '@/services/search/search-test-fixtures'
import { CORE_SEARCH_SOURCE_TYPES, type SearchSource, type SearchSourceType } from '@/services/search/types'

// The tag facet has its own suite (sources.tag-facet.test.ts), and the object
// factories are shared from search-test-fixtures.ts, both so this file stays
// under the repo's file-size limit.
//
// Only the community sources are covered here. A feature's source lives beside
// its client (services/kpi/search-source.ts, services/report/search-source.ts)
// and is tested there; that federated search receives it is pinned in
// src/features/search-sources.test.ts.

function getSource(type: SearchSourceType): SearchSource {
  const source = SEARCH_SOURCES.find((s) => s.type === type)
  if (!source) throw new Error(`no search source registered for type ${type}`)
  return source
}

afterEach(() => {
  useMockDataStore.setState({
    queries: [],
    dashboards: [],
    datasets: [],
  })
})

describe('search sources', () => {
  it('normalizes a mock query into a namespaced, routable result', () => {
    expect(queryToResult(makeQuery(7, 'Bus ridership'))).toEqual({
      id: 'query-7',
      type: 'query',
      title: 'Bus ridership',
      subtitle: undefined,
      href: '/queries/7',
      updatedAt: '2026-01-02T00:00:00Z',
    })
  })

  it('normalizes a mock dashboard into a namespaced, routable result', () => {
    expect(dashboardToResult(makeDashboard(9, 'Bus dashboard'))).toEqual({
      id: 'dashboard-9',
      type: 'dashboard',
      title: 'Bus dashboard',
      href: '/dashboards/9',
      updatedAt: '2026-01-02T00:00:00Z',
    })
  })

  // Exactly the core types and nothing else. A feature's source is not in this
  // array at all any more: it arrives through the registry, and that the
  // assembled list covers the registry's own idea of which search types exist
  // is asserted in src/features/search-sources.test.ts.
  it('registers the three community source types, and no feature ones', () => {
    expect(SEARCH_SOURCES.map((s) => s.type)).toEqual([...CORE_SEARCH_SOURCE_TYPES])
  })

  it('normalizes a mock dataset into a namespaced, routable result', () => {
    expect(datasetToResult(makeDataset('bus-ridership', 'Bus ridership'))).toEqual({
      id: 'catalog-bus-ridership',
      type: 'catalog',
      title: 'Bus ridership',
      subtitle: undefined,
      href: '/data/dataset/bus-ridership',
      updatedAt: '2026-01-02T00:00:00Z',
    })
  })

  it('catalog source filters the mock store by name in mock mode', async () => {
    useMockDataStore.setState({
      datasets: [makeDataset('bus-ridership', 'Bus ridership'), makeDataset('rail-delays', 'Rail delays')],
    })
    const source = getSource('catalog')
    const results = await source.search('bus', {})
    expect(results).toEqual([datasetToResult(makeDataset('bus-ridership', 'Bus ridership'))])
    expect(results[0].type).toBe('catalog')
    expect(results[0].href).toBe('/data/dataset/bus-ridership')
    expect(results[0].updatedAt).toBe('2026-01-02T00:00:00Z')
  })

  it('catalog source returns nothing for a blank query', async () => {
    useMockDataStore.setState({ datasets: [makeDataset('bus-ridership', 'Bus ridership')] })
    const source = getSource('catalog')
    expect(await source.search('   ', {})).toEqual([])
  })

  it('queries source filters the mock store by name in mock mode', async () => {
    useMockDataStore.setState({
      queries: [makeQuery(1, 'Bus ridership'), makeQuery(2, 'Rail delays')],
    })
    const source = getSource('query')
    const results = await source.search('bus', {})
    expect(results).toEqual([queryToResult(makeQuery(1, 'Bus ridership'))])
    expect(results[0].type).toBe('query')
    expect(results[0].href).toBe('/queries/1')
    expect(results[0].updatedAt).toBe('2026-01-02T00:00:00Z')
  })

  it('dashboards source filters the mock store by name in mock mode', async () => {
    useMockDataStore.setState({
      dashboards: [makeDashboard(5, 'Bus dashboard'), makeDashboard(6, 'Rail map')],
    })
    const source = getSource('dashboard')
    const results = await source.search('bus', {})
    expect(results).toEqual([dashboardToResult(makeDashboard(5, 'Bus dashboard'))])
    expect(results[0].type).toBe('dashboard')
    expect(results[0].href).toBe('/dashboards/5')
    expect(results[0].updatedAt).toBe('2026-01-02T00:00:00Z')
  })

  it('queries source returns nothing for a blank query', async () => {
    useMockDataStore.setState({ queries: [makeQuery(1, 'Bus ridership')] })
    const source = getSource('query')
    expect(await source.search('   ', {})).toEqual([])
  })

  it('dashboards source excludes archived dashboards even on a name match', async () => {
    const archived = { ...makeDashboard(2, 'Bus archive'), is_archived: true }
    useMockDataStore.setState({ dashboards: [archived] })
    const source = getSource('dashboard')
    expect(await source.search('bus', {})).toEqual([])
  })

  // Mock mode hid every draft while Redash returns them (include_drafts=True on
  // both branches of the queries handler), so the same search disagreed between
  // local and stage.
  it('includes drafts, and still excludes archived, as the backend does', async () => {
    useMockDataStore.setState({
      queries: [
        { ...makeQuery(1, 'Draft boardings'), is_draft: true },
        { ...makeQuery(2, 'Archived boardings'), is_archived: true },
        makeQuery(3, 'Saved boardings'),
      ],
    })

    const results = await getSource('query').search('boardings', {})

    expect(results.map((r) => r.title).sort()).toEqual(['Draft boardings', 'Saved boardings'])
  })
})
