// What the assembler owes federated search: the community sources always, the
// installed features' sources appended in registry order, and a feature whose
// loader cannot be reached costing that feature's results rather than the
// whole search.
//
// Every case passes its own registry object rather than mocking the module.
// That is the pattern the rest of src/features uses (featureList and friends
// all take the registry as an optional final parameter), and here it is also
// what keeps the cache honest: the cache is keyed on the registry identity, so
// a test that resolves a stub cannot leak into the next one.
import { describe, expect, it, vi } from 'vitest'
import { assembleSearchSources } from './search-sources'
import { featureSearchTypes } from './index'
import type { FeatureDescriptor } from './types'
import { SEARCH_SOURCES } from '@/services/search/sources'
import { CORE_SEARCH_SOURCE_TYPES, type SearchSource } from '@/services/search/types'

function stubSource(type: string): SearchSource {
  return { type, label: type, search: async () => [] }
}

function stubFeature(id: string, source?: SearchSource): FeatureDescriptor {
  return {
    id,
    nav: [],
    routes: [],
    ...(source ? { searchSource: async () => source } : {}),
  }
}

describe('assembleSearchSources', () => {
  it('returns exactly the community sources when no feature contributes one', async () => {
    // This is the community build: three sources, no KPIs and no reports, and
    // nothing thrown for their absence.
    expect(await assembleSearchSources({})).toEqual(SEARCH_SOURCES)
    expect(SEARCH_SOURCES.map((source) => source.type)).toEqual([...CORE_SEARCH_SOURCE_TYPES])
  })

  it('hands back a copy, so a caller cannot mutate the community list', async () => {
    const assembled = await assembleSearchSources({})
    expect(assembled).not.toBe(SEARCH_SOURCES)
  })

  it('appends a contributed source after the community ones', async () => {
    const kpiish = stubSource('stub-kpi')
    const assembled = await assembleSearchSources({ kpis: stubFeature('kpis', kpiish) })
    expect(assembled).toEqual([...SEARCH_SOURCES, kpiish])
  })

  it('orders contributions by registry key, not by object insertion order', async () => {
    // Search result grouping reads this order, so it has to be a property of
    // the registry and not of however the object literal happened to be typed.
    const zebra = stubSource('stub-zebra')
    const alpha = stubSource('stub-alpha')
    const assembled = await assembleSearchSources({
      zebra: stubFeature('zebra', zebra),
      alpha: stubFeature('alpha', alpha),
    })
    expect(assembled.map((source) => source.type)).toEqual([
      ...SEARCH_SOURCES.map((source) => source.type),
      'stub-alpha',
      'stub-zebra',
    ])
  })

  it('ignores a feature that contributes no search source', async () => {
    const contributed = stubSource('stub-kpi')
    const assembled = await assembleSearchSources({
      alerts: stubFeature('alerts'),
      kpis: stubFeature('kpis', contributed),
    })
    expect(assembled).toEqual([...SEARCH_SOURCES, contributed])
  })

  it('drops a source whose loader rejects, logs why, and keeps the rest', async () => {
    // A community build whose overlay chunk is missing must lose that
    // feature's results, not every result. federatedSearch already fails this
    // way for a source that answers badly; a source that cannot be loaded at
    // all is the same event one step earlier.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const survivor = stubSource('stub-report')
    const assembled = await assembleSearchSources({
      kpis: { id: 'kpis', nav: [], routes: [], searchSource: () => Promise.reject(new Error('no chunk')) },
      reports: stubFeature('reports', survivor),
    })
    expect(assembled).toEqual([...SEARCH_SOURCES, survivor])
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('E_SEARCH_002'))
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('kpis'))
    logged.mockRestore()
  })

  it('loads each contributor once for a given registry, because search runs per keystroke', async () => {
    const factory = vi.fn(async () => stubSource('stub-kpi'))
    const registry = { kpis: { id: 'kpis', nav: [], routes: [], searchSource: factory } }
    await assembleSearchSources(registry)
    await assembleSearchSources(registry)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('caches per registry, so one registry cannot answer for another', async () => {
    const first = stubSource('stub-first')
    const second = stubSource('stub-second')
    expect(await assembleSearchSources({ a: stubFeature('a', first) })).toEqual([...SEARCH_SOURCES, first])
    expect(await assembleSearchSources({ a: stubFeature('a', second) })).toEqual([...SEARCH_SOURCES, second])
  })

  it('retries a loader that failed instead of caching its absence for the session', async () => {
    // The cache exists to keep per-keystroke work down, not to make a
    // transient chunk failure permanent until the tab is reloaded.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const late = stubSource('stub-late')
    const factory = vi
      .fn<() => Promise<SearchSource>>()
      .mockRejectedValueOnce(new Error('no chunk'))
      .mockResolvedValueOnce(late)
    const registry = { kpis: { id: 'kpis', nav: [], routes: [], searchSource: factory } }
    expect(await assembleSearchSources(registry)).toEqual(SEARCH_SOURCES)
    expect(await assembleSearchSources(registry)).toEqual([...SEARCH_SOURCES, late])
    expect(factory).toHaveBeenCalledTimes(2)
    logged.mockRestore()
  })

  it('defaults to the installed registry and still yields every community source', async () => {
    const assembled = await assembleSearchSources()
    expect(assembled.map((source) => source.type)).toEqual(
      expect.arrayContaining(SEARCH_SOURCES.map((source) => source.type))
    )
  })

  // Nothing else in this file would notice a descriptor that declared a
  // searchType and then never contributed a source: the two fields are
  // independent, and a feature that appears in the palette's type filters while
  // returning no results is the exact shape of that bug. Derived from the
  // registry rather than from a literal ['kpi', 'report'], so a fifth feature
  // cannot be added with a search type and no source without failing here.
  //
  // The drifted type would not merely miss results either: labels and icons are
  // looked up by type in services/search/types.ts and search-result-row.tsx, so
  // a type on one side and not the other resolves to undefined in both.
  it('supplies a source for every search type the installed registry declares, and no others', async () => {
    const expected = new Set<string>([
      ...CORE_SEARCH_SOURCE_TYPES,
      ...featureSearchTypes().map((searchType) => searchType.type),
    ])
    const assembled = await assembleSearchSources()
    expect(new Set(assembled.map((source) => source.type))).toEqual(expected)
  })

  // Nothing is appended that no descriptor asked for. Written as an equality
  // rather than a `toContain`, because what would go wrong here is an extra
  // source ARRIVING, not one going missing: the case above already covers the
  // registry's own contributions.
  //
  // Two registries, because "nothing extra" has two ways to break, and the
  // second is the one an empty registry cannot reach: a build that installs
  // features which declare no searchSource at all. Alerts and wall are exactly
  // that pair in the shipped pack. Both are stated rather than read off the
  // installed registry, so this holds in a composed build too, where
  // search-sources.enterprise.test.ts asserts the appended order the real
  // descriptors produce.
  it('appends nothing when no installed feature contributes a source', async () => {
    expect((await assembleSearchSources({})).map((source) => source.type)).toEqual([
      ...CORE_SEARCH_SOURCE_TYPES,
    ])
    const quiet = await assembleSearchSources({
      alerts: stubFeature('alerts'),
      wall: stubFeature('wall'),
    })
    expect(quiet.map((source) => source.type)).toEqual([...CORE_SEARCH_SOURCE_TYPES])
  })
})
