// Central error ID registry.
//
// Rules:
//   1. Never reuse a retired ID: mark it `// retired` and leave it in place.
//   2. One ID per distinct cause, not per throw site.
//   3. Numbers are stable; append, never renumber.
//   4. Domain prefix (3-5 letters) is required.
//
// Throw via `new AppError(ErrorIds.X, '...', { context })`. Log lines include
// the ID so grep, telemetry, and agents can all find every occurrence with one
// search. This is a seed: route existing throws through it on-touch, not as a
// bulk refactor (see ../../.claude/rules/starter-patterns.md).

export const ErrorIds = {
  // ── Config / env (CFG) ────────────────────────────────────────────────────
  CFG_ENV_MISSING: 'E_CFG_001',
  CFG_ENV_INVALID: 'E_CFG_002',

  // ── Upstream backends (UP): Redash, ClickHouse ────────────────────────────
  UP_UNREACHABLE: 'E_UP_001',
  UP_TIMEOUT: 'E_UP_002',
  UP_BAD_STATUS: 'E_UP_003',
  UP_BAD_SHAPE: 'E_UP_004',

  // ── API route handlers (API) ──────────────────────────────────────────────
  API_BAD_REQUEST: 'E_API_001',
  API_NOT_FOUND: 'E_API_002',
  API_UPSTREAM_FAILED: 'E_API_003',

  // ── Auth / permissions (AUTH) ─────────────────────────────────────────────
  AUTH_NO_SESSION: 'E_AUTH_001',
  AUTH_FORBIDDEN: 'E_AUTH_002',
  // A route asked for the internal Redash API key on a path that declares no
  // Redash-side gate, so there is nothing to check the caller against. Refused
  // rather than guessed: the key acts as its owning super admin, so guessing
  // wrong escalates whoever called the route. Register the path in
  // INTERNAL_KEY_ENDPOINTS (src/lib/redash-server.ts) with the permission
  // Redash's own handler demands.
  AUTH_INTERNAL_KEY_UNGATED: 'E_AUTH_003',

  // ── UI / visualization rendering (UI) ─────────────────────────────────────
  UI_VIZ_RENDER_FAILED: 'E_UI_001',
  UI_VIZ_GEOJSON_FAILED: 'E_UI_002',

  // ── Search federation (SEARCH) ────────────────────────────────────────────
  SEARCH_SOURCE_FAILED: 'E_SEARCH_001',
  // A feature's search source could not be loaded at all, so that feature
  // contributes nothing to this search. Distinct from SEARCH_SOURCE_FAILED,
  // which is a source that loaded and then failed to answer: this one names a
  // build whose registry promises a source its code cannot supply, which is
  // what a half-applied overlay looks like.
  SEARCH_SOURCE_UNAVAILABLE: 'E_SEARCH_002',

  // ── Feature slots (SLOT) ───────────────────────────────────────────────────
  // A slot's contributed component could not be loaded, so the surface kept
  // the community fallback it would have shown with no contributor at all.
  // The same event SEARCH_SOURCE_UNAVAILABLE names, one surface over: a
  // registry that promises a component this build cannot supply, which is what
  // a community tree pointed at an enterprise API looks like. Not an error the
  // user should ever see, and deliberately not a thrown one: a missing overlay
  // degrades to the community view, never to a blank page.
  SLOT_UNAVAILABLE: 'E_SLOT_001',

  // ── AI proposal kinds (PROPOSAL) ───────────────────────────────────────────
  // A converse turn converged on a proposal of a kind this build has no card
  // for, so nothing was rendered. The third member of the family above: the
  // proposal contract is community (a community service can propose a KPI),
  // but the card that creates one ships with the feature, so this is the state
  // a community build is in when it talks to a service that has the pack, and
  // it is what a rolling deploy looks like from the browser. Ignored rather
  // than thrown, and logged rather than silent, because a half-drawn card is
  // worse than no card and an unexplained empty panel is worse than both.
  PROPOSAL_KIND_UNSUPPORTED: 'E_PROPOSAL_001',
  // The kind IS registered, but its card could not be loaded. Same shape as
  // SLOT_UNAVAILABLE: the registry promised something this build cannot supply.
  PROPOSAL_CARD_UNAVAILABLE: 'E_PROPOSAL_002',

  // ── Mock-mode fixtures (MOCK) ──────────────────────────────────────────────
  // A feature's mock collections could not be loaded, so mock mode starts with
  // that feature's collections empty rather than with its fixtures. The same
  // family again: a registry entry whose chunk this build cannot supply. Empty
  // and not absent, which is the whole property this seam has to hold: every
  // reader of a contributed collection reads an array.
  MOCK_DATA_UNAVAILABLE: 'E_MOCK_001',

  // ── Data Catalog (CATALOG) ─────────────────────────────────────────────────
  CATALOG_FETCH_FAILED: 'E_CATALOG_001',

  // ── Published feeds (PUBFEED) ──────────────────────────────────────────────
  PUBLISHED_FEED_REQUEST_FAILED: 'E_PUBFEED_001',

  // ── KPI object (KPI) ───────────────────────────────────────────────────────
  KPI_FETCH_FAILED: 'E_KPI_001',

  // ── Favorites on sidecar objects (FAVORITE) ────────────────────────────────
  // Reading or writing a star on a KPI or a report. Redash's own favorites
  // (queries, dashboards) fail through the Redash client and never land here.
  FAVORITES_REQUEST_FAILED: 'E_FAVORITE_001',

  // ── Reports (REPORT) ───────────────────────────────────────────────────────
  REPORT_FETCH_FAILED: 'E_REPORT_001',
  // A snapshot that could not resolve every linked data block. Nothing is
  // frozen and no stamp is written, so the author has to be told.
  REPORT_SNAPSHOT_INCOMPLETE: 'E_REPORT_002',
  // A failed write that can no longer be replayed as it stands, because the
  // block it named has left the document since. Replaying it would act on
  // whatever took that block's place, so it is refused instead.
  REPORT_RETRY_STALE: 'E_REPORT_003',
  // A generic report update that carried a lifecycle or audit field. State,
  // visibility, the public token and the audit trail move only through the
  // transition endpoints, which check the publish permission.
  REPORT_PATCH_FORBIDDEN: 'E_REPORT_004',
  // A document write against a report that is in review. The review is the
  // point at which the content stops moving, so the write is refused.
  REPORT_EDIT_LOCKED: 'E_REPORT_005',
  // A rejection with no note. A rejection that says nothing is not a review.
  REPORT_NOTE_REQUIRED: 'E_REPORT_006',
  // A write whose outcome the client could not establish: the response was
  // lost and the reconcile that would have settled it also failed. Replaying
  // it blindly can commit the same change twice.
  REPORT_WRITE_UNCERTAIN: 'E_REPORT_007',
  // A write refused before it was sent because the authoritative GET that
  // resolves the edit lock and the write base could not reach the server.
  // Proceeding would PATCH a full document against a possibly-stale base past a
  // possibly-stale lock, so the write fails closed instead.
  REPORT_WRITE_BLOCKED: 'E_REPORT_008',
  // A document write carrying a data block that has a frozen result but names
  // no query. A result is produced by running a query, so a block with one and
  // no source carries a number nobody can trace back to the data.
  REPORT_BLOCK_UNSOURCED: 'E_REPORT_009',
  // A removal the backend refused. Its own id rather than REPORT_FETCH_FAILED
  // because the interesting case is a 403 from a reader who does not own the
  // report, and that has to be greppable apart from a failed read.
  REPORT_DELETE_FAILED: 'E_REPORT_010',

  // AI generation (AI)
  AI_REQUEST_FAILED: 'E_AI_001',
  AI_SPEC_INVALID: 'E_AI_002',
  // An AI-authored query that saved but would not run. Its own id because the
  // caller's next step depends on it: a dashboard panel can live with this and
  // offer Refresh, while a KPI reads one number out of the result and has
  // nothing to be without it.
  AI_WRITTEN_QUERY_UNRUNNABLE: 'E_AI_003',
  // The query ran and the column the KPI was told to read is not in it. The two
  // names come from two separate model calls (the conversation names the column,
  // a second generation writes the SQL and picks its own aliases), so nothing
  // upstream makes them agree.
  AI_WRITTEN_QUERY_COLUMN_MISSING: 'E_AI_004',

  // Queries (QUERY)
  // An operation the fixtures cannot represent. Mock mode mints no per-query
  // API keys, so there is nothing to rotate; failing loudly beats reporting a
  // rotation that did not happen.
  QUERY_NOT_IN_MOCK: 'E_QUERY_001',

  // Add new domains/IDs below. Keep the comment header above each domain.
} as const

export type ErrorId = (typeof ErrorIds)[keyof typeof ErrorIds]

export class AppError extends Error {
  readonly id: ErrorId
  readonly context: Record<string, unknown>

  constructor(id: ErrorId, message: string, context: Record<string, unknown> = {}) {
    super(message)
    this.id = id
    this.context = context
    this.name = 'AppError'
  }

  toLogLine(): string {
    const ctx = Object.entries(this.context)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ')
    return `[${this.id}] ${this.message}${ctx ? ' ' + ctx : ''}`
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError
}
