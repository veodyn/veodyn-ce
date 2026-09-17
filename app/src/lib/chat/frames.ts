import { z } from 'zod'

const id = z.string().min(1).max(128)

export const chatProposalSchema = z
  .object({
    name: z.string().min(1).max(500),
    description: z.string().max(10_000),
    sql: z.string().min(1).max(60_000),
    datasetTable: z.string().min(1).max(255),
    vizChoiceId: z.string().min(1).max(64),
    vizOptions: z.record(z.unknown()),
  })
  .strict()

const frameData = {
  turn_started: z.object({ turnId: id, seq: z.number().int().positive() }).strict(),
  text_delta: z.object({ text: z.string().max(20_000) }).strict(),
  status: z
    .object({ phase: z.enum(['answering', 'validating', 'waiting_for_browser', 'reading_result']) })
    .strict(),
  tool_request: z
    .object({
      callId: id,
      tool: z.literal('run_query'),
      args: z
        .object({
          dataSourceId: z.number().int().positive(),
          sql: z.string().min(1).max(60_000),
          purpose: z.string().max(500),
          vizChoiceId: z.string().min(1).max(64),
        })
        .strict(),
    })
    .strict(),
  tool_settled: z
    .object({
      callId: id,
      ok: z.boolean(),
      durationMs: z.number().int().nonnegative(),
      rowCount: z.number().int().nonnegative().optional(),
    })
    .strict(),
  draft: z
    .object({
      draftId: id,
      version: z.number().int().positive(),
      kind: z.literal('query'),
      payload: chatProposalSchema,
    })
    .strict(),
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

export type ChatFrame = {
  [K in ChatEvent]: { event: K; id: string | null; data: z.infer<(typeof frameData)[K]> }
}[ChatEvent]

export type ChatToolRequest = z.infer<(typeof frameData)['tool_request']>

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
