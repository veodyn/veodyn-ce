import { z } from 'zod'
import { dashboardEditPayloadSchema, dashboardProposalSchema, dashboardUpdateArgsShape } from './dashboard-changes'
import { operationArgs, operationPayloadSchema, type OperationToolName } from './operation-changes'
import { parameterListSchema, queryChangesSchema, queryEditPayloadSchema } from './query-changes'
import { vizNextSchema, vizOperationsShape, vizPayloadSchema } from './viz-changes'

const id = z.string().min(1).max(128)
const positive = z.number().int().positive()
const savedQueryParameter = z.union([
  z.string().max(500),
  z.number(),
  z.array(z.string().max(500)).max(50),
  z.object({ start: z.string().max(64), end: z.string().max(64) }).strict(),
])

export const chatProposalSchema = z
  .object({
    name: z.string().min(1).max(500),
    description: z.string().max(10_000),
    sql: z.string().min(1).max(60_000),
    dataSourceId: positive,
    datasetTable: z.string().min(1).max(255).optional(),
    vizChoiceId: z.string().min(1).max(64),
    vizOptions: z.record(z.unknown()),
    parameters: parameterListSchema.optional(),
  })
  .strict()

export const KPI_SLUG = /^[A-Za-z0-9._~-]+$/
const kpiSlug = z.string().min(1).max(255).regex(KPI_SLUG)

declare const openName: unique symbol
export type OpenName = string & { readonly [openName]: true }

const kpiProposalArgsShape = {
  name: z.string().min(1).max(255),
  description: z.string().max(4_000),
  sourceQueryId: positive.nullable(),
  queryDraftId: z.string().min(1).max(64).nullable(),
  valueColumn: z.string().min(1).max(255),
  unit: z.string().max(64).nullable(),
  target: z.number(),
  direction: z.enum(['higher-is-better', 'lower-is-better']),
  cadence: z.enum(['hourly', 'daily', 'weekly']),
  atRisk: z.number().nullable(),
  breached: z.number().nullable(),
}

const resultKind = z.string().min(1).max(64)

function operationRequest<T extends OperationToolName>(tool: T) {
  return z.object({ callId: id, tool: z.literal(tool), args: operationArgs[tool] }).strict()
}

const knownToolRequest = z.discriminatedUnion('tool', [
    z
      .object({
        callId: id,
        tool: z.literal('run_query'),
        args: z
          .object({
            dataSourceId: positive,
            sql: z.string().min(1).max(60_000),
            purpose: z.string().max(500),
            vizChoiceId: z.string().min(1).max(64),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        callId: id,
        tool: z.literal('run_saved_query'),
        args: z
          .object({
            queryId: positive,
            parameters: z.record(savedQueryParameter).refine((value) => Object.keys(value).length <= 20),
            visualizationId: positive.nullable(),
            purpose: z.string().max(500),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        callId: id,
        tool: z.literal('list_data_sources'),
        args: z.object({}).strict(),
      })
      .strict(),
    z
      .object({
        callId: id,
        tool: z.literal('describe_data_source'),
        args: z.object({ dataSourceId: positive }).strict(),
      })
      .strict(),
    z
      .object({
        callId: id,
        tool: z.literal('search_library'),
        args: z
          .object({
            text: z.string().max(200),
            kinds: z.array(z.enum(['query', 'dashboard'])).min(1).max(2),
            tags: z.array(z.string().min(1).max(64)).max(5),
            sort: z.enum(['match', 'recent']).optional(),
            archived: z.boolean().optional(),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        callId: id,
        tool: z.literal('show_visualization'),
        args: z.object({ queryId: positive, visualizationId: positive.nullable() }).strict(),
      })
      .strict(),
    z
      .object({
        callId: id,
        tool: z.literal('open_dashboard'),
        args: z.object({ dashboardId: positive }).strict(),
      })
      .strict(),
    z
      .object({
        callId: id,
        tool: z.literal('open_query'),
        args: z.object({ queryId: positive }).strict(),
      })
      .strict(),
    z
      .object({
        callId: id,
        tool: z.literal('update_dashboard'),
        args: z.object(dashboardUpdateArgsShape).strict(),
      })
      .strict(),
    z
      .object({
        callId: id,
        tool: z.literal('update_query'),
        args: z.object({ queryId: positive, changes: queryChangesSchema, format: z.boolean().optional() }).strict(),
      })
      .strict(),
    z
      .object({
        callId: id,
        tool: z.literal('describe_visualization_type'),
        args: z.object({ type: z.string().min(1).max(64) }).strict(),
      })
      .strict(),
    z
      .object({
        callId: id,
        tool: z.literal('propose_visualization'),
        args: z
          .object({ queryId: positive, type: vizNextSchema.shape.type, name: vizNextSchema.shape.name, options: vizNextSchema.shape.options })
          .strict(),
      })
      .strict(),
    z
      .object({
        callId: id,
        tool: z.literal('update_visualization'),
        args: z
          .object({
            queryId: positive,
            visualizationId: positive,
            type: vizNextSchema.shape.type.optional(),
            name: vizNextSchema.shape.name.optional(),
            ...vizOperationsShape,
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        callId: id,
        tool: z.literal('delete_visualization'),
        args: z.object({ queryId: positive, visualizationId: positive }).strict(),
      })
      .strict(),
    z
      .object({
        callId: id,
        tool: z.literal('show_kpi'),
        args: z.object({ kpiId: kpiSlug }).strict(),
      })
      .strict(),
    z
      .object({
        callId: id,
        tool: z.literal('list_kpis'),
        args: z.object({}).strict(),
      })
      .strict(),
    z
      .object({
        callId: id,
        tool: z.literal('update_snippet'),
        args: z
          .object({
            snippetId: positive,
            trigger: z.string().min(1).max(255).optional(),
            snippet: z.string().min(1).max(10_000).optional(),
            description: z.string().max(1_000).optional(),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        callId: id,
        tool: z.literal('delete_snippet'),
        args: z.object({ snippetId: positive }).strict(),
      })
      .strict(),
    z
      .object({
        callId: id,
        tool: z.literal('propose_kpi'),
        args: z.object(kpiProposalArgsShape).strict(),
      })
      .strict(),
    operationRequest('fork_query'),
    operationRequest('archive_query'),
    operationRequest('archive_dashboard'),
    operationRequest('set_favorite'),
    operationRequest('share_dashboard'),
    operationRequest('share_visualization'),
    operationRequest('download_result'),
  ])

const KNOWN_TOOLS: ReadonlySet<string> = new Set(knownToolRequest.options.map((option) => option.shape.tool.value))

const openToolRequest = z
  .object({
    callId: id,
    tool: z
      .string()
      .min(1)
      .max(64)
      .refine((name) => !KNOWN_TOOLS.has(name))
      .transform((name) => name as OpenName),
    args: z.record(z.unknown()),
    resultKind: resultKind.optional(),
  })
  .strict()

const knownDraft = z.discriminatedUnion('kind', [
    z
      .object({
        draftId: id,
        version: z.number().int().positive(),
        kind: z.literal('query'),
        payload: chatProposalSchema,
      })
      .strict(),
    z
      .object({
        draftId: id,
        version: z.number().int().positive(),
        kind: z.literal('dashboard'),
        payload: dashboardProposalSchema,
      })
      .strict(),
    z
      .object({
        draftId: id,
        version: z.number().int().positive(),
        kind: z.literal('query_edit'),
        payload: queryEditPayloadSchema,
      })
      .strict(),
    z
      .object({
        draftId: id,
        version: z.number().int().positive(),
        kind: z.literal('visualization'),
        payload: vizPayloadSchema,
      })
      .strict(),
    z
      .object({
        draftId: id,
        version: z.number().int().positive(),
        kind: z.literal('dashboard_edit'),
        payload: dashboardEditPayloadSchema,
      })
      .strict(),
    z
      .object({
        draftId: id,
        version: z.number().int().positive(),
        kind: z.literal('operation'),
        payload: operationPayloadSchema,
      })
      .strict(),
  ])

const KNOWN_DRAFT_KINDS: ReadonlySet<string> = new Set(knownDraft.options.map((option) => option.shape.kind.value))

const openDraft = z
  .object({
    draftId: id,
    version: z.number().int().positive(),
    kind: z
      .string()
      .min(1)
      .max(64)
      .refine((kind) => !KNOWN_DRAFT_KINDS.has(kind))
      .transform((kind) => kind as OpenName),
    payload: z.record(z.unknown()),
  })
  .strict()

const frameData = {
  turn_started: z.object({ turnId: id, seq: z.number().int().positive() }).strict(),
  text_delta: z.object({ text: z.string().max(20_000) }).strict(),
  status: z
    .object({ phase: z.enum(['answering', 'validating', 'waiting_for_browser', 'reading_result']) })
    .strict(),
  tool_request: z.union([knownToolRequest, openToolRequest]),
  tool_settled: z
    .object({
      callId: id,
      ok: z.boolean(),
      durationMs: z.number().int().nonnegative(),
      rowCount: z.number().int().nonnegative().optional(),
      count: z.number().int().nonnegative().optional(),
      sourceCount: z.number().int().nonnegative().optional(),
    })
    .strict(),
  help_link: z
    .object({
      callId: id,
      page: z.string().max(200),
      pageTitle: z.string().max(500),
      anchor: z.string().min(1).max(200).nullable(),
      sectionTitle: z.string().max(500).nullable(),
      reason: z.string().max(500),
    })
    .strict(),
  draft: z.union([knownDraft, openDraft]),
  turn_done: z
    .object({
      stopReason: z.string().max(64),
      usage: z.record(z.union([z.number(), z.string().max(200)])),
    })
    .strict(),
  error: z.object({ id: z.string().max(128), message: z.string().max(1_000) }).strict(),
} as const

export type ChatEvent = keyof typeof frameData
export type ChatProposal = z.infer<typeof chatProposalSchema>
export type DashboardProposal = z.infer<typeof dashboardProposalSchema>
export type { QueryEditPayload } from './query-changes'
export { dashboardProposalSchema }
export type DashboardProposalItem = DashboardProposal['items'][number]
export type KnownDraftFrame = z.infer<typeof knownDraft>
export type OpenDraftFrame = z.infer<typeof openDraft>
export type DraftFrame = KnownDraftFrame | OpenDraftFrame

export function isOpenDraft(frame: DraftFrame): frame is OpenDraftFrame {
  return !KNOWN_DRAFT_KINDS.has(frame.kind)
}

export function isKnownToolName(name: string): boolean {
  return KNOWN_TOOLS.has(name)
}

export function isOpenToolRequest(request: AnyToolRequest): request is OpenToolRequest {
  return !KNOWN_TOOLS.has(request.tool)
}

export type ChatFrame = {
  [K in ChatEvent]: { event: K; id: string | null; data: z.infer<(typeof frameData)[K]> }
}[ChatEvent]

export type ChatToolRequest = z.infer<typeof knownToolRequest>
export type OpenToolRequest = z.infer<typeof openToolRequest>
export type AnyToolRequest = ChatToolRequest | OpenToolRequest
export type ChatToolName = ChatToolRequest['tool']
export type ChatToolRequestOf<T extends ChatToolName> = Extract<ChatToolRequest, { tool: T }>

export const CHAT_EVENTS = Object.keys(frameData) as ChatEvent[]

export const TERMINAL_EVENTS: ReadonlySet<ChatEvent> = new Set<ChatEvent>(['turn_done', 'error'])

export const CHAT_UNAVAILABLE_ERROR_ID = 'VEODYN_AI_CHAT_UNAVAILABLE'

function isEvent(value: string): value is ChatEvent {
  return Object.prototype.hasOwnProperty.call(frameData, value)
}

export function parseFrame(event: string, data: unknown, frameId: string | null): ChatFrame | null {
  if (!isEvent(event)) return null
  if (event === 'tool_request') return parseToolRequest(data, frameId)
  const parsed = frameData[event].safeParse(data)
  if (!parsed.success) return null
  return { event, id: frameId, data: parsed.data } as ChatFrame
}

function parseToolRequest(data: unknown, frameId: string | null): ChatFrame | null {
  if (data === null || typeof data !== 'object') return null
  const { resultKind: expected, ...rest } = data as Record<string, unknown>
  const closed = knownToolRequest.safeParse(rest)
  if (closed.success) {
    return expected === undefined || resultKind.safeParse(expected).success
      ? { event: 'tool_request', id: frameId, data: closed.data }
      : null
  }
  const open = openToolRequest.safeParse(data)
  return open.success ? { event: 'tool_request', id: frameId, data: open.data } : null
}
