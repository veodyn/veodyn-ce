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
  // Null when the feed has no query behind it. What the engine orders attempts
  // on is a source version, which for a query-backed feed is this same number.
  queryResultId: number | null
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

/** The standards a binding may name. Both are community code. */
export type FeedStandard = 'gtfs-rt' | 'gbfs'

/** What a write sends. Every field, every time: the endpoint is a PUT. */
export interface PublishedFeedInput {
  slug: string
  /**
   * Null for an entity whose producer builds the feed from something other than
   * a query result. Which entities those are is `EntityNeeds.query` below, and
   * the API refuses a null for any entity that needs one, so this is never a
   * silent fallback: it is either a real binding or a named refusal.
   */
  queryId: number | null
  standard: FeedStandard
  // Not a Literal: each standard's serializer owns its supported set, and the
  // API refuses a version outside it naming what it does support.
  version: string
  // Not a Literal: services/published_feed_registry.py holds the entity vocabulary at
  // runtime, PER STANDARD, seeded with vehicle_positions and stations and
  // widened by an enterprise pack, so the wire contract stays one string
  // regardless of which pack is installed. See FeedCapabilities below for what
  // a deployment actually registers.
  entity: string
  /** The scheduled feed a gtfs-rt feed extends. Null for gbfs, which has none. */
  staticGtfsRef: string | null
  /**
   * What system_information.json declares and no query returns: system_id,
   * language, name and timezone, plus opening_hours and feed_contact_email on
   * 3.0. Null for gtfs-rt, which publishes no such file.
   */
  systemInfo: Record<string, string> | null
  sourceColumn: string | null
  columnMap: Record<string, string>
  onError: 'block' | 'last_good'
  lastGoodMaxAgeSeconds: number | null
  /**
   * Off leaves the last good artifact serving when a publish fails; on clears
   * the served pointer, so the feed goes dark rather than serving something the
   * latest validation did not cover.
   */
  retireOnFailure: boolean
  visibility: 'private' | 'public'
}

export interface PublishedFeed extends PublishedFeedInput {
  revision: number
  // Only ever fresh in a write response. Both read paths hard-code `unknown`,
  // so no read path may render this as mapping validity.
  bindingState: string
}

/**
 * Which halves of a binding one entity's producer consumes, so the form asks
 * for those and no others. A property of the producer, not of the standard:
 * `publish_produce.py` is where a producer declares it, and an entity nothing
 * has registered a producer for reports its standard's defaults rather than
 * "needs nothing".
 */
export interface EntityNeeds {
  query: boolean
  staticReference: boolean
  columnMap: boolean
  retirementOnFailure: boolean
}

/** One standard this deployment can publish, and what it offers under it. */
export interface StandardCapability {
  standard: string
  versions: string[]
  entities: string[]
  /** Keyed by the names in `entities`. */
  entityNeeds: Record<string, EntityNeeds>
  /**
   * The timezone names this standard's system declaration accepts, from the
   * enum in the schema the validator judges a publish against. Empty for a
   * standard that declares no timezone, and empty when that schema could not be
   * read, which the form renders as a text field.
   */
  timezones: string[]
}

/**
 * What GET /published-feeds/capabilities answers: what this deployment actually
 * registered, per standard, sorted. A list of one renders as a stated fact and
 * a longer one as a picker, for versions and entities alike. Read at runtime
 * rather than inferred from a values file, per root CLAUDE.md's note that an
 * installed layer is inert until a deployment names it.
 */
export interface FeedCapabilities {
  standards: StandardCapability[]
}
