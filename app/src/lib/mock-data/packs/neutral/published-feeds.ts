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
    sourceColumn: null,
    columnMap: { vehicle_id: 'bus', latitude: 'lat', longitude: 'lon' },
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
