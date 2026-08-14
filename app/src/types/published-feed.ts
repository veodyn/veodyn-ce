// The published-feed surface, mirroring PublishedFeedIn / PublishedFeedOut and
// PublishAttemptOut in api/veodyn_api/schemas/published_feed.py. Hand-written
// rather than imported from the generated declaration, which is the convention
// every other domain here follows; published-feed.contract.test.ts is what
// keeps the two from drifting.

/** One validator finding, flattened to one occurrence. */
export interface PublishFinding {
  ruleId: string
  severity: string
  title: string
  locator: string
}

export interface PublishAttempt {
  attemptId: number
  bindingRevision: number
  queryResultId: number
  // A blocked attempt is the mapping or the data. A failed one is the
  // machinery, and carries a sentence instead of findings.
  decision: 'published' | 'blocked' | 'failed'
  reason: string
  findings: PublishFinding[]
  enabledRules: string[]
  /** The served artifact. At most one attempt per feed carries it. */
  isCurrent: boolean
  createdAt: string
}

/** What a write sends. Every field, every time: the endpoint is a PUT. */
export interface PublishedFeedInput {
  slug: string
  queryId: number
  standard: 'gtfs-rt'
  version: '2.0'
  entity: 'vehicle_positions'
  staticGtfsRef: string
  sourceColumn: string | null
  columnMap: Record<string, string>
  onError: 'block' | 'last_good'
  lastGoodMaxAgeSeconds: number | null
  visibility: 'private' | 'public'
}

export interface PublishedFeed extends PublishedFeedInput {
  revision: number
  // Only ever fresh in a write response. Both read paths hard-code `unknown`,
  // so no read path may render this as mapping validity.
  bindingState: string
}
