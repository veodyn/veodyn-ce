import { z } from 'zod'

const id = z.string().min(1).max(128)
const positive = z.number().int().positive()

export const chatProposalSchema = z
  .object({
    name: z.string().min(1).max(500),
    description: z.string().max(10_000),
    sql: z.string().min(1).max(60_000),
    dataSourceId: positive,
    datasetTable: z.string().min(1).max(255).optional(),
    vizChoiceId: z.string().min(1).max(64),
    vizOptions: z.record(z.unknown()),
  })
  .strict()

const dashboardItemSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('draft'), queryDraftId: id, title: z.string().max(500).optional() })
    .strict(),
  z
    .object({
      kind: z.literal('existing'),
      queryId: positive,
      visualizationId: positive,
      title: z.string().max(500).optional(),
    })
    .strict(),
])

export const dashboardProposalSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(1_000),
    items: z.array(dashboardItemSchema).min(1).max(12),
  })
  .strict()

export const KPI_SLUG = /^[A-Za-z0-9._~-]+$/
const kpiSlug = z.string().min(1).max(255).regex(KPI_SLUG)

const frameData = {
  turn_started: z.object({ turnId: id, seq: z.number().int().positive() }).strict(),
  text_delta: z.object({ text: z.string().max(20_000) }).strict(),
  status: z
    .object({ phase: z.enum(['answering', 'validating', 'waiting_for_browser', 'reading_result']) })
    .strict(),
  tool_request: z.discriminatedUnion('tool', [
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
  ]),
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
  draft: z.discriminatedUnion('kind', [
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
  ]),
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
export type DashboardProposalItem = DashboardProposal['items'][number]
export type DraftFrame = z.infer<(typeof frameData)['draft']>

export type ChatFrame = {
  [K in ChatEvent]: { event: K; id: string | null; data: z.infer<(typeof frameData)[K]> }
}[ChatEvent]

export type ChatToolRequest = z.infer<(typeof frameData)['tool_request']>
export type ChatToolName = ChatToolRequest['tool']
export type ChatToolRequestOf<T extends ChatToolName> = Extract<ChatToolRequest, { tool: T }>

export const CHAT_EVENTS = Object.keys(frameData) as ChatEvent[]

export const TERMINAL_EVENTS: ReadonlySet<ChatEvent> = new Set<ChatEvent>(['turn_done', 'error'])

function isEvent(value: string): value is ChatEvent {
  return Object.prototype.hasOwnProperty.call(frameData, value)
}

export function parseFrame(event: string, data: unknown, frameId: string | null): ChatFrame | null {
  if (!isEvent(event)) return null
  const parsed = frameData[event].safeParse(data)
  if (!parsed.success) return null
  return { event, id: frameId, data: parsed.data } as ChatFrame
}
