// The pack this build actually uses. One module reference, so the bundler has
// exactly one thing to resolve and exactly one pack to include.
//
// THIS FILE IS THE FALLBACK, not usually what a build gets. next.config.ts
// rewrites `@/lib/mock-data/packs/active` to a single pack through
// turbopack.resolveAlias:
//
//   NEXT_PUBLIC_REDASH_URL set   ->  ./empty     (real backend; no fixture is read)
//   NEXT_PUBLIC_DEMO_PACK=la     ->  ./la        (only present inside a private
//                                                  tenant overlay build, which
//                                                  copies packs/la back onto
//                                                  disk before `pnpm build`
//                                                  runs)
//   otherwise                    ->  ./neutral
//
// What is left here is the neutral pack, written so that tsc and Vitest, which
// read no Next config, still resolve something real. There is no ternary on
// NEXT_PUBLIC_DEMO_PACK left to keep: packs/la carried real customer hostnames
// and org names and has moved out to a private pack repo, so it never exists
// in this checkout for any env value to select, and this fallback cannot
// import it either. The suite runs on the pack the product actually ships.
//
// The previous arrangement did this selection inside index.ts, which meant
// index.ts imported BOTH packs and Turbopack shipped both: 388 KB of fixtures
// in the client bundle to use at most 196 KB of them. index.ts said so in a
// comment and called the alias a follow-up. This is that follow-up.
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
  mockFeeds,
} = neutral
