// The registry seam for mock-mode fixtures.
//
// Mock mode is not a test convenience here: it is what `pnpm test:e2e` runs
// against and what the docs screenshots are produced from, so what the mock
// store holds is load-bearing for two gates outside the unit suite. It is also
// where the CE/EE split is most easily got wrong, because the failure is not a
// crash. A collection that used to be an array of fixtures and is now
// `undefined` reads as "this build has no KPIs" on one screen and throws
// `Cannot read properties of undefined` on the next.
//
// So the rule this module exists to hold is narrow and absolute: a collection
// nobody contributes is `[]`. Not missing, not null, not a thrown error, and
// not a store that refuses to construct. Everything else here is in service of
// that.
//
// Like features/search-sources.ts, features/slots.tsx and features/proposals.ts,
// this module is NOT re-exported from features/index.ts: that entry point is
// reached from the server root layout through src/lib/theme-preference.ts.
import { AppError, ErrorIds } from '@/lib/errorIds'
import { FEATURES } from './generated-registry'
import { featureList } from './index'
import type { FeatureDescriptor, MockDataFactory } from './types'

type MockContributor = FeatureDescriptor & { mockData: MockDataFactory }

function contributorsIn(registry: Record<string, FeatureDescriptor>): MockContributor[] {
  return featureList(registry).filter(
    (feature): feature is MockContributor => feature.mockData !== undefined
  )
}

/**
 * Every collection the installed features seed, merged, in featureList order.
 *
 * Two features naming one collection CONCATENATE rather than one winning. That
 * is the opposite of the rule for slots and proposal kinds, and deliberately
 * so: a slot is one hole and only one component can be in it, while a
 * collection is a list and two features both having rows to put in it is an
 * ordinary thing rather than a packaging mistake. Order follows featureList so
 * a build's fixtures do not reshuffle between runs, which matters because the
 * screenshots are diffed.
 *
 * A contributor whose loader rejects costs that feature's fixtures and nothing
 * else. It does not reject this promise: a half-applied overlay has to leave
 * mock mode running with an empty KPI list, not with a store that never
 * resolved.
 */
export async function assembleMockData(
  registry: Record<string, FeatureDescriptor> = FEATURES
): Promise<Record<string, unknown[]>> {
  const contributors = contributorsIn(registry)
  const settled = await Promise.allSettled(contributors.map((feature) => feature.mockData()))

  const merged: Record<string, unknown[]> = {}
  settled.forEach((result, index) => {
    if (result.status !== 'fulfilled') {
      const error = new AppError(
        ErrorIds.MOCK_DATA_UNAVAILABLE,
        "A feature's mock fixtures could not be loaded; its collections start empty",
        { feature: contributors[index].id, reason: String(result.reason) }
      )
      console.error(error.toLogLine())
      return
    }
    for (const [collection, rows] of Object.entries(result.value)) {
      merged[collection] = [...(merged[collection] ?? []), ...rows]
    }
  })
  return merged
}
