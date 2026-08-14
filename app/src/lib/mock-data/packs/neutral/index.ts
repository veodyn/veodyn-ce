// Value-only re-exports for the neutral demo pack. Types are not re-exported
// here: the canonical types live in packs/la and are re-exported from the
// top-level src/lib/mock-data/index.ts selector.
//
// mockKpis and mockReports are NOT here, though ./kpis.ts and ./reports.ts
// still are. They belong to installed features rather than to the pack
// surface every pack has to match, and they reach the mock store through those
// features' descriptors. See ../../kpi-fixtures.ts.
export { mockUsers, currentUser } from './users'
export { mockQueries } from './queries'
export { mockQueryResults } from './query-results'
export { mockDashboards } from './dashboards'
export { mockDataSources } from './data-sources'
export { mockDataSourceTypes } from './data-source-types'
export { mockAlerts } from './alerts'
export { mockGroups } from './groups'
export { mockDestinations } from './destinations'
export { mockDestinationTypes } from './destination-types'
export { mockQuerySnippets } from './query-snippets'
export { mockSchema } from './schema'
export { mockDatasets, mockDomainHubs } from './catalog'
export { mockAnnotations } from './annotations'
export { mockFeeds } from './feeds'
export { mockPublishedFeeds, mockPublishAttempts } from './published-feeds'
