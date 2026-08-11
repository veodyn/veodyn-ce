// Mock-mode coverage for the tag facet across the community sources, plus
// hasTag itself, which every source shares. The feature sources answer the same
// facet with the same helper and are covered beside their own clients, in
// services/kpi/search-source.test.ts and services/report/search-source.test.ts.
//
// A tag chip navigates to /search?tag=, so the facet has to mean "carries this
// tag" and not "mentions this word": as a search term it would both over-match
// (any query merely describing "rail") and under-match (a query tagged rail
// whose name says nothing about it).
import { afterEach, describe, expect, it } from 'vitest'
import { SEARCH_SOURCES, hasTag } from '@/services/search/sources'
import { useMockDataStore } from '@/stores/mock-data-store'
import { makeDashboard, makeDataset, makeQuery } from '@/services/search/search-test-fixtures'
import type { SearchSource, SearchSourceType } from '@/services/search/types'

function sourceFor(type: SearchSourceType): SearchSource {
  const source = SEARCH_SOURCES.find((s) => s.type === type)
  if (!source) throw new Error(`no source for ${type}`)
  return source
}

afterEach(() => {
  useMockDataStore.setState({
    queries: [],
    dashboards: [],
    datasets: [],
  })
})

describe('tag facet', () => {
  // Exact including case, matching Redash's own filter_by_tags, which is
  // case-sensitive array containment. A case-insensitive match here would find
  // a query tagged "Rail" in mock mode and in the catalog but not in the
  // queries a real Redash answers for.
  it('matches a tag exactly, including case', () => {
    expect(hasTag(['rail'], 'rail')).toBe(true)
    expect(hasTag(['Rail'], 'rail')).toBe(false)
    // An identifier, so no substring matching: these are different tags.
    expect(hasTag(['rail-history'], 'rail')).toBe(false)
    expect(hasTag([], 'rail')).toBe(false)
    expect(hasTag(undefined, 'rail')).toBe(false)
  })

  it('returns everything carrying the tag, with no search term', async () => {
    const tagged = makeQuery(1, 'Boardings', ['rail'])
    const untagged = makeQuery(2, 'Rail mentions in the name')
    useMockDataStore.setState({ queries: [tagged, untagged] })

    const results = await sourceFor('query').search('', { tag: 'rail' })

    expect(results.map((r) => r.title)).toEqual(['Boardings'])
  })

  it('narrows by the term as well when both are given', async () => {
    useMockDataStore.setState({
      queries: [makeQuery(1, 'Rail boardings', ['rail']), makeQuery(2, 'Rail delays', ['rail'])],
    })

    const results = await sourceFor('query').search('delays', { tag: 'rail' })

    expect(results.map((r) => r.title)).toEqual(['Rail delays'])
  })

  it('filters dashboards and datasets by tag too', async () => {
    useMockDataStore.setState({
      dashboards: [makeDashboard(1, 'Transit', ['rail']), makeDashboard(2, 'Weather', ['air'])],
      datasets: [makeDataset('a', 'Vehicles', ['rail']), makeDataset('b', 'Stations', ['bike'])],
    })

    expect((await sourceFor('dashboard').search('', { tag: 'rail' })).map((r) => r.title)).toEqual([
      'Transit',
    ])
    expect((await sourceFor('catalog').search('', { tag: 'rail' })).map((r) => r.title)).toEqual([
      'Vehicles',
    ])
  })

  it('still returns nothing when neither a term nor a tag is given', async () => {
    useMockDataStore.setState({ queries: [makeQuery(1, 'Anything', ['rail'])] })

    expect(await sourceFor('query').search('', {})).toEqual([])
  })
})
