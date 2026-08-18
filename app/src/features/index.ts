// The single seam every shared surface reads instead of importing a feature's
// implementation directly: nav, search and route metadata for every feature
// this build contains, derived from the generated registry rather than
// re-listed here, so the sidebar, search and route guards cannot drift against
// what src/features/ holds.
//
// Descriptors are pure data: importing this file, or any value it returns,
// never pulls in a feature's components, hooks or services. See
// app/src/features/types.ts and the boundary guard in
// feature-boundary.test.ts.

export { FEATURES } from './generated-registry'
import { FEATURES } from './generated-registry'

export type { FeatureDescriptor, FeatureNavRow, FeatureRoute, FeatureSearchType, NavSectionId } from './types'
import type { FeatureDescriptor, FeatureNavRow, FeatureRoute, FeatureSearchType, NavSectionId } from './types'

/**
 * Every installed feature's descriptor, sorted by key so callers that derive
 * ordered lists (nav rows, search tabs) do not reshuffle between builds.
 *
 * Every helper below takes the registry as an optional final parameter,
 * defaulting to the real `FEATURES`, so a test can exercise the empty-registry
 * path (`{}`) without mocking this module.
 */
export function featureList(registry: Record<string, FeatureDescriptor> = FEATURES): FeatureDescriptor[] {
  return Object.keys(registry)
    .sort()
    .map((key) => registry[key])
}

/**
 * Whether a feature package is installed in this build.
 *
 * The right question for a community surface holding a single link into a
 * feature's territory (the Recipients button on a feed, the Present button on a
 * dashboard): the feature contributes no component and no data, and the surface
 * already knows the whole link, so a slot would be the wrong shape.
 *
 * Keyed on the registry key, which is the package directory name and is equal
 * to `descriptor.id` (asserted by feature-boundary.test.ts).
 *
 * `Object.hasOwn` and not `registry[id] !== undefined`: the registry is an
 * ordinary object literal, so an indexed read of 'toString' or 'constructor'
 * walks the prototype and comes back with a function, which a truthiness test
 * would report as an installed feature.
 */
export function hasFeature(id: string, registry: Record<string, FeatureDescriptor> = FEATURES): boolean {
  return Object.hasOwn(registry, id)
}

/**
 * Whether this build installs no feature packages at all.
 *
 * Asked by TESTS, never by product code. A few community suites assert a
 * property of the COMMUNITY REPOSITORY rather than of the code they import
 * (scripts/check-ce-tree.test.ts, enterprise-route-links.test.ts,
 * src/plugins/index.test.ts). Each is correctly FALSE in a tree with the pack
 * composed into it, and the same files run there, so each guards itself with
 * this. A skip carrying a reason is visible in the runner output; a path
 * exclusion in CI is not.
 *
 * Not a gate for product behaviour: a surface that needs to know whether one
 * feature is present asks `hasFeature`.
 */
export function installsNoFeaturePackages(registry: Record<string, FeatureDescriptor> = FEATURES): boolean {
  return featureList(registry).length === 0
}

/**
 * The nav rows every installed feature contributes to one sidebar section, in
 * featureList() order.
 */
export function featureNavRows(
  section: NavSectionId,
  registry: Record<string, FeatureDescriptor> = FEATURES
): FeatureNavRow[] {
  return featureList(registry).flatMap((feature) => feature.nav.filter((row) => row.section === section))
}

/**
 * Every installed feature's federated-search identity, in featureList()
 * order. A feature with no searchType (alerts, wall) contributes nothing.
 */
export function featureSearchTypes(registry: Record<string, FeatureDescriptor> = FEATURES): FeatureSearchType[] {
  return featureList(registry)
    .map((feature) => feature.searchType)
    .filter((searchType): searchType is FeatureSearchType => searchType !== undefined)
}

/**
 * The route rule an installed feature owns for this path, or undefined if no
 * installed feature claims it.
 */
export function featureRouteFor(
  pathname: string,
  registry: Record<string, FeatureDescriptor> = FEATURES
): FeatureRoute | undefined {
  for (const feature of featureList(registry)) {
    for (const route of feature.routes) {
      if (route.pattern.test(pathname)) return route
    }
  }
  return undefined
}
