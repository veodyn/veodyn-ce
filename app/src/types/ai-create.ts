// The Create-with-AI conversation contract. Mirrored by ConverseIn/ConverseOut
// in veodyn_api/schemas/ai.py and checked twice: once there on the way out,
// once by the Zod schema in src/app/api/ai/converse/route.ts on the way in.
// Change one, change the other; docs/docs/operations/ai-provider.md carries
// the contract those three sides are all mirroring.
//
// Unlike /ai/outline, the request carries NO grounding. The service assembles
// the catalog and the query list itself, so a modified client cannot make the
// model believe in a table that does not exist.
//
// Two of the five kinds a turn can converge on, `kpi` and `report`, are owned
// by installed features rather than by this module: their wire shapes live
// beside the code that renders them (`KpiProposal` in @/types/kpi,
// `ReportProposal` in @/types/ai-report) and reach the chat through
// `FeatureDescriptor.proposals`. `CreateKind` still names all five, because the
// SERVICE contract does: `schemas/ai_create.py` is community, so a build with
// no KPI feature can still hold a conversation that proposes one. What that
// build does not have is a card to render it; see FeatureProposal below.

export type CreateKind = 'query' | 'dashboard' | 'kpi' | 'report' | 'snippet'

export interface ConverseMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ConverseRequest {
  kind: CreateKind
  messages: ConverseMessage[]
  // The dashboard being EDITED rather than created. An id and nothing else:
  // the service reads what the dashboard actually holds, so this cannot tell
  // the model the dashboard contains something it does not.
  targetDashboardId?: number
  // The table the previous turn said it profiled, handed back so the next turn
  // profiles the same one. The endpoint is stateless, so this round trip is the
  // whole mechanism: without it every turn re-decides which table it is talking
  // about. A name and nothing else, and the service checks it against the
  // catalog, so naming a table here cannot invent one.
  focusTable?: string | null
}

export interface QueryProposal {
  kind: 'query'
  name: string
  description: string
  sql: string
  datasetTable: string
  // A VIZ_CHOICES id (src/lib/viz-choices.ts), not a Redash type: a chart shape
  // is an *option* on a CHART visualization. resolveVizChoice turns this into
  // {type, options} and falls back to the table for an id this build no longer
  // offers.
  vizChoiceId: string
  // Renderer options the service authored for that shape against the columns
  // the statement actually returns: a column mapping, stacking, an axis scale.
  // Already sanitized against the same per-type allowlist a published report
  // goes through, so it is a bounded record rather than arbitrary JSON.
  //
  // Always present, often empty. Not optional: the wire always carries the key.
  vizOptions: Record<string, unknown>
}

/**
 * A query the AI wrote because the instance does not have one that fits.
 *
 * The same fields QueryProposal carries minus its discriminator, because every
 * container creates it with the same call: write the query, then point the
 * container at what it produced. Its SQL came from the generator the query
 * conversation uses, so it has been through the same safety check.
 *
 * Three things carry one: a dashboard widget, a KPI, and a report outline
 * section (`OutlineSection.newQuery` in ai-report.ts).
 */
export interface NewQueryProposal {
  name: string
  description: string
  sql: string
  datasetTable: string
  vizChoiceId: string
  // As QueryProposal.vizOptions, and required for the same reason.
  vizOptions: Record<string, unknown>
}

/**
 * One widget: a query that exists, or one to be written first.
 *
 * Exactly one of the pair, which the service enforces before it answers. Both
 * halves are always present on the wire (the unused one null), so the card
 * reads one shape and decides by which is filled in.
 */
export interface DashboardWidgetProposal {
  title: string
  queryId: number | null
  visualizationId: number | null
  /**
   * The shape this widget should be drawn as, from `viz-choices.ts`.
   *
   * Null means "as it is drawn now", which is what an unchanged widget of an
   * edit carries. Beside a `visualizationId` it names the shape that id already
   * is, so the diff can tell a real change from a widget the model merely
   * repeated. WITHOUT one it means the query has no visualization of that shape
   * and the client has to create it, which is the only path here that writes to
   * a saved query and therefore the one that checks who owns it first.
   */
  vizChoiceId: string | null
  newQuery: NewQueryProposal | null
}

export interface DashboardProposal {
  kind: 'dashboard'
  name: string
  widgets: DashboardWidgetProposal[]
}

export interface SnippetProposal {
  kind: 'snippet'
  trigger: string
  snippet: string
  description: string
}

/** The kinds this build has a card for, whatever features are installed. */
export type Proposal = QueryProposal | DashboardProposal | SnippetProposal

/**
 * A proposal whose kind belongs to an installed feature.
 *
 * Opaque here on purpose: the discriminator is all the community half is
 * allowed to know, because the fields under it are the feature's contract with
 * its own card, not with this module. `FeatureDescriptor.proposals` is where a
 * feature claims a kind, says whether a given payload is one of its own, and
 * supplies the card; `src/features/proposals.ts` is what routes to it.
 *
 * The index signature is what keeps this from silently absorbing the three
 * kinds above: an interface is not assignable to an index-signature type, so
 * `isCommunityProposal` (proposal-model.ts) stays the only way across.
 */
export interface FeatureProposal {
  kind: string
  readonly [field: string]: unknown
}

/**
 * Anything a converse turn may carry: a kind this build renders itself, or one
 * an installed feature does. Held loosely from the relay all the way to
 * ProposalPanel, which is the single place that decides which it is.
 */
export type AnyProposal = Proposal | FeatureProposal

export interface ConverseResponse {
  reply: string
  suggestedAnswers: string[]
  // Invariant, enforced at both ends: ready === (proposal !== null). There is
  // exactly one way to be ready, so a UI cannot show a Create button for
  // nothing, and a "here is your report" reply cannot arrive empty.
  ready: boolean
  proposal: AnyProposal | null
  // Which table this turn profiled, for the client to send back on the next
  // one. Null when the conversation has not settled on one yet.
  //
  // Always present, never optional: the wire always carries the key, and the
  // relay's response schema is strict about exactly this key set.
  focusTable: string | null
}

// Shared by the composer, the relay and the service.
export const MAX_USER_TURNS = 12
export const MAX_MESSAGE_CHARS = 4_000
export const MAX_TRANSCRIPT_MESSAGES = 25
