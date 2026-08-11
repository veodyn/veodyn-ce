// The single seam every shared surface reads instead of importing a feature's
// implementation directly: nav, search and route metadata for every feature
// this build contains, derived from the generated registry rather than
// re-listed here, so the sidebar, search and route guards can never drift
// against what src/features/ actually holds.
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
 * defaulting to the real `FEATURES`, the same pattern
 * `buildSidebarSections` uses for `featureNavRows` in `lib/sidebar-nav.ts`.
 * That lets a test exercise the real empty-registry path (`{}`) without
 * mocking this module, rather than only ever running against whatever
 * packages happen to be installed in this build.
 */
export function featureList(registry: Record<string, FeatureDescriptor> = FEATURES): FeatureDescriptor[] {
  return Object.keys(registry)
    .sort()
    .map((key) => registry[key])
}

/**
 * Whether a feature package is installed in this build.
 *
 * The coarsest question the registry answers, and the right one for a
 * community surface holding a single link into a feature's territory: the
 * Recipients button on a feed points at the alert that feed drives, and the
 * Present button on a dashboard points at the wall package's /present. A slot
 * would be the wrong shape for either, because the feature contributes no
 * component and no data; the community surface already knows the whole link
 * and only needs to know whether the destination exists.
 *
 * Keyed on the registry key, which is the package directory name and is equal
 * to `descriptor.id` (asserted by feature-boundary.test.ts).
 *
 * `Object.hasOwn` and not `registry[id] !== undefined`: the registry is an
 * ordinary object literal, so an indexed read of 'toString' or 'constructor'
 * walks the prototype and comes back with a function, which a truthiness or
 * undefined test would report as an installed feature.
 */
export function hasFeature(id: string, registry: Record<string, FeatureDescriptor> = FEATURES): boolean {
  return Object.hasOwn(registry, id)
}

/**
 * Whether this build installs no feature packages at all.
 *
 * Derived from the registry, which is the real distinction: it is empty in a
 * community build and holds one entry per package in a composed one. Named for
 * what it means rather than for where it runs, because nothing about it is a
 * property of a directory layout, a marker file or a CI job.
 *
 * Why a TEST would ever ask, since no product code does. A few community
 * suites assert a property of the COMMUNITY REPOSITORY rather than of the code
 * they import: scripts/check-ce-tree.test.ts says no enterprise path is
 * present, enterprise-route-links.test.ts says no community module links to an
 * enterprise route, and src/plugins/index.test.ts says only the public plugin
 * packages are tracked in git. Each is correctly FALSE in a tree that has the
 * pack composed into it, and the same files run there, so each guards itself
 * with this and states at the site what it is an invariant of. A skip carrying
 * a reason is visible in the runner output; a path exclusion in CI is not.
 *
 * Not a gate for product behaviour. A surface that needs to know whether one
 * feature is present asks `hasFeature`, and a surface that renders differently
 * merely because the build is a community one does not exist.
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
