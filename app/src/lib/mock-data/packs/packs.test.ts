// What keeps the fixture packs substitutable.
//
// A build swaps one pack for another through turbopack.resolveAlias
// (next.config.ts), which is a resolution-level swap: nothing type-checks the
// substitution, because tsc only ever sees ./active. If a pack grows an export
// the others do not have, the alias produces `undefined` at whatever call site
// reads it, in the one configuration nobody runs locally. These tests are the
// check the compiler cannot make.
import { describe, expect, it } from 'vitest'
import * as neutral from './neutral'
import * as empty from './empty'
import * as active from './active'

// The value exports. Types are not listed: they erase, they all come from the
// neutral pack through src/lib/mock-data/index.ts, and a missing one is a
// compile error rather than an undefined at runtime.
//
// mockKpis and mockReports are not listed either, and that is the point of
// this list rather than an oversight in it: they are contributed by installed
// features through FeatureDescriptor.mockData, so a pack is under no
// obligation to carry them and a community build has no collection for them
// to fill. The neutral pack still HAS the rows; what it no longer has is an
// export of them (src/lib/mock-data/kpi-fixtures.ts).
const VALUE_EXPORTS = [
  'mockUsers',
  'currentUser',
  'mockQueries',
  'mockQueryResults',
  'mockDashboards',
  'mockDataSources',
  'mockDataSourceTypes',
  'mockAlerts',
  'mockGroups',
  'mockDestinations',
  'mockDestinationTypes',
  'mockQuerySnippets',
  'mockSchema',
  'mockDatasets',
  'mockDomainHubs',
  'mockAnnotations',
  'mockFeeds',
] as const

// neutral, empty, active: la carried real customer hostnames and org names
// and has moved to a private repo, so it is no longer one of the builds this
// suite can pin to. Three packs are still enough to catch the failure this
// file is aimed at (a fixture added to one pack and forgotten in another
// reads as `undefined` at runtime): neutral is the reference shape, empty is
// the shape with no rows, and active is whichever of them the selector picked
// for this test run.
const PACKS = { neutral, empty, active }

function valueNames(pack: object): string[] {
  return Object.keys(pack)
    .filter((key) => typeof (pack as Record<string, unknown>)[key] !== 'undefined')
    .sort()
}

describe('every pack is substitutable for every other', () => {
  it.each(Object.keys(PACKS))('%s exports exactly the agreed value surface', (name) => {
    const pack = PACKS[name as keyof typeof PACKS]
    expect(valueNames(pack)).toEqual([...VALUE_EXPORTS].sort())
  })

  // The failure this is really aimed at: a fixture added to neutral but
  // forgotten in empty reads as `undefined` only in a build with a real
  // backend, which is production and nowhere else.
  it.each(VALUE_EXPORTS)('%s is defined in all three packs', (name) => {
    for (const [packName, pack] of Object.entries(PACKS)) {
      expect((pack as Record<string, unknown>)[name], `${packName}.${name}`).toBeDefined()
    }
  })

  it.each(VALUE_EXPORTS)('%s has the same shape in empty as in neutral', (name) => {
    const neutralValue = (neutral as Record<string, unknown>)[name]
    const emptyValue = (empty as Record<string, unknown>)[name]
    expect(Array.isArray(emptyValue), `${name} array-ness`).toBe(Array.isArray(neutralValue))
    expect(typeof emptyValue, `${name} type`).toBe(typeof neutralValue)
  })
})

describe('the empty pack carries no fixture data', () => {
  // Its whole reason to exist. A pack that quietly kept a few rows would ship
  // them to production while claiming to be the reason nothing ships.
  it.each(VALUE_EXPORTS.filter((n) => n !== 'currentUser'))('%s is empty', (name) => {
    const value = (empty as Record<string, unknown>)[name]
    if (Array.isArray(value)) {
      expect(value).toHaveLength(0)
    } else {
      expect(Object.keys(value as object)).toHaveLength(0)
    }
  })

  // currentUser cannot be empty (it is a single object, not a collection), so
  // what is pinned instead is that it can never stand in for a person: no
  // sign-in can match it and no lookup can find it.
  it('has a currentUser that no credential can match and no lookup can find', () => {
    expect(empty.currentUser.email).toBe('')
    expect(empty.currentUser.is_disabled).toBe(true)
    expect(empty.mockUsers).toHaveLength(0)
  })
})
