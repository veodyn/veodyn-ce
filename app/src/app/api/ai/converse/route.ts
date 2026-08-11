import { z } from 'zod'
import { mockConverse } from '@/lib/ai-mock'
import { handleAiRelay } from '@/lib/ai-proxy'
import {
  MAX_MESSAGE_CHARS,
  MAX_TRANSCRIPT_MESSAGES,
  MAX_USER_TURNS,
  type ConverseRequest,
  type ConverseResponse,
} from '@/types/ai-create'

export const dynamic = 'force-dynamic'

// The caps are imported, never retyped: the composer, this relay and the
// service all enforce the same three numbers, and a copy here would let them
// drift apart silently (spec section 4.3).
const converseRequestSchema: z.ZodType<ConverseRequest> = z
  .object({
    kind: z.enum(['query', 'dashboard', 'kpi', 'report', 'snippet']),
    targetDashboardId: z.number().int().positive().optional(),
    // Echoed back from the previous turn, so the service profiles the table the
    // conversation is already about. Accepted as a bare name and nothing more:
    // the service resolves it against the catalog, so a caller naming a table
    // here cannot make the model believe in one.
    focusTable: z.string().min(1).max(255).nullish(),
    messages: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant']),
            content: z.string().min(1).max(MAX_MESSAGE_CHARS),
          })
          .strict()
      )
      // A transcript with nothing in it is not a turn: the client always sends
      // at least the message the user just typed.
      .min(1)
      .max(MAX_TRANSCRIPT_MESSAGES),
  })
  .strict()
  // The turn cap counts USER messages only. Capping the array alone would let a
  // caller spend thirteen turns by dropping the assistant's replies.
  .refine((value) => value.messages.filter((m) => m.role === 'user').length <= MAX_USER_TURNS)

// ── The provider's success shape ────────────────────────────────────────────
//
// Every proposal object is strict. A drift between veodyn_api/schemas/ai.py and
// this file has to surface as "AI is broken" rather than as a tolerated
// difference (spec section 2), so an unexpected field is a 502 here and not a
// quietly dropped key.
//
// A description may legitimately be empty, a name may not: an object with no
// name is not something the create card can show a user.
const name = z.string().min(1).max(500)
const description = z.string().max(10_000)
const objectId = z.number().int().positive()

const queryProposalSchema = z
  .object({
    kind: z.literal('query'),
    name,
    description,
    sql: z.string().min(1).max(50_000),
    datasetTable: z.string().min(1).max(255),
    // Not checked against VIZ_CHOICES here: resolveVizChoice already falls back
    // to the table for an id this build no longer offers, and importing
    // viz-choices would pull React thumbnail components into a route handler.
    vizChoiceId: z.string().min(1).max(64),
    // Authored by the service against the statement's real result columns and
    // sanitized against the same allowlist the public report path uses, so this
    // is a bounded record rather than arbitrary JSON. Validating its shape again
    // here would mean a second copy of that table in TypeScript.
    vizOptions: z.record(z.string(), z.unknown()),
  })
  .strict()

// A query the service wrote for a container that had nothing that fits. One
// schema, three containers (a widget, a KPI, a report section), because all three
// carry the identical object and the card creates it with the same call.
const newQuerySchema = z
  .object({
    name,
    description,
    sql: z.string().min(1).max(50_000),
    datasetTable: z.string().min(1).max(255),
    vizChoiceId: z.string().min(1).max(64),
    // As on the query proposal, and bounded for the same reason.
    vizOptions: z.record(z.string(), z.unknown()),
  })
  .strict()

// A widget is either an existing query or one the service just wrote. Both
// halves are declared nullable rather than a union of two object shapes: the
// service always sends both keys, and a discriminated union here would 502 on
// the null it sends for the half that does not apply.
const dashboardWidgetSchema = z
  .object({
    title: name,
    queryId: objectId.nullable(),
    visualizationId: objectId.nullable(),
    // The shape to draw it as. Null on a widget nobody asked to change, and set
    // WITHOUT a visualizationId when the query has nothing of that shape and so
    // the client has to create one.
    vizChoiceId: z.string().max(64).nullable(),
    newQuery: newQuerySchema.nullable(),
  })
  .strict()
  // The same invariant the service asserts, checked again here because this
  // relay is the boundary the browser trusts: a widget with both would create
  // one query and show another, and a widget with neither is an empty row.
  .refine((widget) => (widget.queryId !== null) !== (widget.newQuery !== null))
  // And an existing query still needs something to draw: an id to point at, or
  // a shape to build one from. The single check above used to cover this by
  // demanding both id halves, which is no longer true of a widget whose shape
  // the query does not have yet.
  .refine(
    (widget) =>
      widget.queryId === null || widget.visualizationId !== null || widget.vizChoiceId !== null
  )

const dashboardProposalSchema = z
  .object({
    kind: z.literal('dashboard'),
    name,
    widgets: z.array(dashboardWidgetSchema).max(50),
  })
  .strict()

const kpiProposalSchema = z
  .object({
    kind: z.literal('kpi'),
    name,
    description,
    sourceQueryId: objectId.nullable(),
    newQuery: newQuerySchema.nullable(),
    valueColumn: z.string().min(1).max(255),
    unit: z.string().max(50).nullable(),
    target: z.number().finite().nullable(),
    direction: z.enum(['higher-is-better', 'lower-is-better']),
    cadence: z.enum(['hourly', 'daily', 'weekly']),
    // Null unless the analyst named a band. Required rather than optional, so
    // what reaches the card is always `number | null` and nothing downstream
    // has to tell an absent band from an unstated one. Safe to require because
    // the service on the other side of this relay ships from the same branch
    // and `openapi.json` is diffed in CI, so the two cannot drift apart
    // unnoticed.
    atRisk: z.number().finite().nullable(),
    breached: z.number().finite().nullable(),
  })
  .strict()

// The same outline the /ai/outline relay accepts, reused here so a report
// proposal cannot carry a shape the report flow would reject downstream.
const reportProposalSchema = z
  .object({
    kind: z.literal('report'),
    outline: z
      .object({
        goal: z.string().min(1).max(10_000),
        sections: z
          .array(
            z
              .object({
                id: z.string().min(1).max(255),
                title: name,
                intent: z.string().min(1).max(10_000),
                sourceQueryId: objectId.nullable(),
                newQuery: newQuerySchema.nullable(),
                suggested: z.boolean(),
                enabled: z.boolean(),
              })
              .strict()
              // Not the widget's rule. A section may carry NEITHER, which is a
              // prose section and a valid thing for an outline to contain; what
              // it may not carry is both.
              .refine((section) => section.sourceQueryId === null || section.newQuery === null)
          )
          .max(100),
      })
      .strict(),
  })
  .strict()

const snippetProposalSchema = z
  .object({
    kind: z.literal('snippet'),
    trigger: z.string().min(1).max(255),
    snippet: z.string().min(1).max(50_000),
    description,
  })
  .strict()

const proposalSchema = z.discriminatedUnion('kind', [
  queryProposalSchema,
  dashboardProposalSchema,
  kpiProposalSchema,
  reportProposalSchema,
  snippetProposalSchema,
])

const converseResponseSchema: z.ZodType<ConverseResponse> = z
  .object({
    reply: z.string().min(1).max(MAX_MESSAGE_CHARS),
    suggestedAnswers: z.array(z.string().min(1).max(200)).max(4),
    ready: z.boolean(),
    proposal: proposalSchema.nullable(),
    // The table this turn profiled. Relayed rather than dropped because the
    // client has to send it back next turn: the endpoint keeps no state, so
    // losing it here is losing the subject of the conversation.
    focusTable: z.string().nullable(),
  })
  .strict()
  // ready === (proposal !== null). Both directions are refused, and refused
  // here rather than in the UI: a Create button for nothing, and a "here is
  // your report" reply with nothing behind it, are the same broken turn.
  //
  // The KPI's exactly-one-source rule rides along here rather than as a
  // `.refine` on kpiProposalSchema, because a refine turns a ZodObject into a
  // ZodEffects and z.discriminatedUnion only accepts objects. The widget
  // equivalent can be a refine because it sits inside an array, not the union.
  .superRefine((value, ctx) => {
    if (value.ready && value.proposal === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proposal'],
        message: 'ready turn carries no proposal',
      })
    }
    if (!value.ready && value.proposal !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ready'],
        message: 'proposal on a turn that is not ready',
      })
    }
    // A KPI carrying both would have the card write one query and read the
    // number out of another; one carrying neither is a Create button with
    // nothing behind it. The service asserts the same invariant before it
    // answers; this is the copy the browser trusts.
    if (value.proposal?.kind === 'kpi') {
      const { sourceQueryId, newQuery } = value.proposal
      if ((sourceQueryId !== null) === (newQuery !== null)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['proposal', 'sourceQueryId'],
          message: 'a KPI names either an existing query or a new one',
        })
      }
    }
  })

export async function POST(request: Request) {
  return handleAiRelay(request, {
    path: 'converse',
    requestSchema: converseRequestSchema,
    invalidMessage: 'invalid converse request',
    responseSchema: converseResponseSchema,
    mock: mockConverse,
  })
}
