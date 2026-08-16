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
  /**
   * How many times the rule fired, which is NOT how many findings carry this
   * ruleId: the validator caps exported samples per rule (1000 in 0.2.0) and
   * reports the total separately, so past that ceiling the findings are a
   * sample and only this knows the real number. Every finding split from one
   * notice repeats that notice's total.
   *
   * Zero on attempts recorded before the field existed. Treat zero as "this
   * attempt does not know" and fall back to the number of locators, rather
   * than rendering a count of none.
   */
  occurrenceCount: number
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
  // Not a Literal: services/feed_registry.py holds the entity vocabulary at
  // runtime, seeded with vehicle_positions and widened by an enterprise pack,
  // so the wire contract stays one string regardless of which pack is
  // installed. See FeedCapabilities below for what a deployment actually
  // registers.
  entity: string
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

/**
 * What GET /published-feeds/capabilities answers: the entity vocabulary this
 * deployment actually registered, sorted. One entry is the community case and
 * renders as a stated fact; more than one means a pack widened the registry
 * and the binding form renders a picker instead. Read at runtime rather than
 * inferred from a values file, per root CLAUDE.md's note that an installed
 * layer is inert until a deployment names it.
 */
export interface FeedCapabilities {
  entities: string[]
}
