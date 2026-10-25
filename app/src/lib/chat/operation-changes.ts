import { z } from 'zod'

const positive = z.number().int().positive()

export const REFRESH_SECONDS = [0, 30, 60, 300, 900] as const
export const MAX_EXPIRES_AT_CHARS = 40
export const DESTRUCTIVE_OPS: ReadonlySet<string> = new Set(['archive', 'revoke'])

const expiresAt = z.string().min(1).max(MAX_EXPIRES_AT_CHARS).nullish()
const refreshSeconds = z
  .number()
  .int()
  .refine((value) => (REFRESH_SECONDS as readonly number[]).includes(value))
  .nullish()
const shareAction = z.enum(['create', 'revoke'])

export const operationArgs = {
  fork_query: z.object({ queryId: positive }).strict(),
  archive_query: z.object({ queryId: positive, restore: z.boolean() }).strict(),
  archive_dashboard: z.object({ dashboardId: positive, restore: z.boolean() }).strict(),
  set_favorite: z.object({ kind: z.enum(['query', 'dashboard']), id: positive, favorite: z.boolean() }).strict(),
  share_dashboard: z.object({ dashboardId: positive, action: shareAction, expiresAt }).strict(),
  share_visualization: z
    .object({ queryId: positive, visualizationId: positive, action: shareAction, expiresAt, refreshSeconds })
    .strict(),
  download_result: z.object({ queryId: positive, format: z.enum(['csv', 'xlsx']) }).strict(),
}

export const operationNameSchema = z.enum(['fork', 'archive', 'restore', 'favorite', 'unfavorite', 'share', 'revoke'])

export const operationTargetSchema = z
  .object({
    kind: z.enum(['query', 'dashboard', 'visualization']),
    id: positive,
    name: z.string().max(500),
    queryId: positive.nullish(),
  })
  .strict()

export const operationParamsSchema = z
  .object({
    summary: z.string().max(1_000).optional(),
    consequence: z.string().max(1_000).optional(),
    copyName: z.string().max(500).optional(),
    queryName: z.string().max(500).optional(),
    expiresAt: z.string().max(MAX_EXPIRES_AT_CHARS).nullish(),
    refreshSeconds: z.number().int().nullish(),
  })
  .passthrough()

export const operationSnapshotSchema = z.object({ updatedAt: z.string().max(64) }).strict()

export const operationPayloadSchema = z
  .object({
    op: operationNameSchema,
    target: operationTargetSchema,
    params: operationParamsSchema,
    destructive: z.boolean(),
    snapshot: operationSnapshotSchema.optional(),
  })
  .strict()

export type OperationName = z.infer<typeof operationNameSchema>
export type OperationTarget = z.infer<typeof operationTargetSchema>
export type OperationParams = z.infer<typeof operationParamsSchema>
export type OperationPayload = z.infer<typeof operationPayloadSchema>
export type OperationToolName = keyof typeof operationArgs
export type OperationCheckToolName = Exclude<OperationToolName, 'download_result'>

export function isDestructive(payload: Pick<OperationPayload, 'op' | 'destructive'>): boolean {
  return payload.destructive || DESTRUCTIVE_OPS.has(payload.op)
}

export const OPERATION_TOOLS: ReadonlySet<string> = new Set(Object.keys(operationArgs))
