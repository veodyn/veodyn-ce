import type { PublishAttempt, PublishedFeed } from '@/types/published-feed'

// Published feeds are a community surface (/connect/feeds), the same as
// mockFeeds beside them: fixtures live directly in the pack rather than
// through the contributed-feature seam that mockKpis and mockReports use.
export const mockPublishedFeeds: PublishedFeed[] = [
  {
    slug: 'vehicles-live',
    revision: 3,
    queryId: 1,
    standard: 'gtfs-rt',
    version: '2.0',
    entity: 'vehicle_positions',
    staticGtfsRef: 'https://example.org/gtfs.zip',
    systemInfo: null,
    sourceColumn: null,
    columnMap: { vehicle_id: 'bus', latitude: 'lat', longitude: 'lon' },
    onError: 'block',
    lastGoodMaxAgeSeconds: null,
    visibility: 'public',
    bindingState: 'unknown',
  },
  {
    slug: 'bikes-live',
    revision: 1,
    queryId: 2,
    standard: 'gbfs',
    version: '2.3',
    entity: 'stations',
    staticGtfsRef: null,
    systemInfo: {
      system_id: 'metro-bikeshare',
      language: 'en',
      name: 'Metro Bike Share',
      timezone: 'America/Los_Angeles',
    },
    sourceColumn: null,
    // Close to what the GBFS connector's stations_joined resource returns, which
    // is the round trip this feature exists for.
    columnMap: {
      station_id: 'station_id',
      name: 'name',
      lat: 'lat',
      lon: 'lon',
      num_vehicles_available: 'num_bikes_available',
      is_installed: 'is_installed',
      is_renting: 'is_renting',
      is_returning: 'is_returning',
      last_reported: 'last_reported',
    },
    onError: 'block',
    lastGoodMaxAgeSeconds: null,
    visibility: 'public',
    bindingState: 'unknown',
  },
]

export const mockPublishAttempts: Record<string, PublishAttempt[]> = {
  'vehicles-live': [
    {
      attemptId: 2,
      bindingRevision: 3,
      queryResultId: 501,
      decision: 'published',
      reason: '',
      findings: [],
      enabledRules: ['E002', 'E003'],
      isCurrent: true,
      createdAt: new Date(Date.now() - 6 * 60_000).toISOString(),
    },
    {
      attemptId: 1,
      bindingRevision: 3,
      queryResultId: 500,
      decision: 'blocked',
      reason: '2 conformance error(s)',
      findings: [
        // occurrenceCount is the validator's TRUE total and the locators are its
        // capped sample, so this pair renders as "showing 2 of 12 occurrences".
        // Deliberately unequal: a fixture where they matched would hide the
        // only case the count exists for.
        { ruleId: 'E003', severity: 'ERROR', title: 'GTFS-rt trip_id does not exist', locator: 'entity 0', occurrenceCount: 12 },
        { ruleId: 'E003', severity: 'ERROR', title: 'GTFS-rt trip_id does not exist', locator: 'entity 4', occurrenceCount: 12 },
      ],
      enabledRules: ['E002', 'E003'],
      isCurrent: false,
      createdAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    },
  ],
}
