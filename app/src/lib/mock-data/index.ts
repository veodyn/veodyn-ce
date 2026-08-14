// Mock fixture aggregation surface. The DATA comes from ./packs/active, which
// is the pack this build selected; the types are identical across packs and are
// sourced from the pack-neutral packs/types/ directory.
//
// This file used to hold the selection itself, importing both packs and
// choosing between them with a ternary on NEXT_PUBLIC_DEMO_PACK. Turbopack does
// not dead-code-eliminate the unselected branch, so BOTH shipped to the browser
// on every route: 388 KB of fixtures to use at most 196 KB of them, and all of
// it dead in a build pointed at a real Redash. The comment here used to say so
// and call the fix a follow-up.
//
// The follow-up is ./packs/active plus the resolveAlias in next.config.ts. One
// module reference, one pack in the bundle, and ./packs/empty when there is a
// real backend and no fixture will be read at all.
export {
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
  mockPublishedFeeds,
  mockPublishAttempts,
  // Imported through the '@/' path rather than './packs/active' on purpose:
  // turbopack.resolveAlias matches the specifier as WRITTEN, so a relative one
  // would resolve past the alias and quietly ship both packs again. The alias
  // key in next.config.ts is this exact string.
} from '@/lib/mock-data/packs/active'

export type { MockUser } from './packs/types/users'
export type {
  MockQuery,
  MockVisualization,
  MockQueryParameter,
  ParameterValue,
} from './packs/types/query-types'
export type { MockQueryResult, QueryResultData, QueryResultColumn } from './packs/types/query-results'
export type { MockDashboard, MockDashboardWidget } from './packs/types/dashboard-types'
export type { MockDataSource } from './packs/types/data-sources'
export type { MockDataSourceType } from './packs/types/data-source-types'
export type { MockAlert, AlertState } from './packs/types/alerts'
export type { MockGroup, MockGroupMember, MockGroupDataSource } from './packs/types/groups'
export type { MockDestination } from './packs/types/destinations'
export type { MockDestinationType } from './packs/types/destination-types'
export type { MockQuerySnippet } from './packs/types/query-snippets'
export type { SchemaTable, SchemaColumn } from './packs/types/schema'
