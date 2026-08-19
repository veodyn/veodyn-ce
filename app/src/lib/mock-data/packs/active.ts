// The pack this build uses. One module reference, so the bundler resolves
// exactly one pack and includes only that one.
//
// THIS FILE IS THE FALLBACK. next.config.ts rewrites
// `@/lib/mock-data/packs/active` through turbopack.resolveAlias:
//
//   NEXT_PUBLIC_REDASH_URL set   ->  ./empty     (real backend; no fixture read)
//   NEXT_PUBLIC_DEMO_PACK=la     ->  ./la        (private tenant overlay build
//                                                  only, which copies packs/la
//                                                  onto disk before the build)
//   otherwise                    ->  ./neutral
//
// The static import below keeps tsc and Vitest, which read no Next config,
// resolving something real. packs/la is not in this checkout, so no ternary on
// NEXT_PUBLIC_DEMO_PACK could select it here.
import * as neutral from './neutral'

export const {
  mockUsers,
  currentUser,
  mockQueries,
  mockQueryResults,
  mockDashboards,
  mockDataSources,
  mockDataSourceTypes,
  mockAlerts,
  mockGroups,
  mockDestinations,
  mockDestinationTypes,
  mockQuerySnippets,
  mockSchema,
  mockDatasets,
  mockDomainHubs,
  mockAnnotations,
  mockCaptures,
  mockPublishedFeeds,
  mockPublishAttempts,
} = neutral
