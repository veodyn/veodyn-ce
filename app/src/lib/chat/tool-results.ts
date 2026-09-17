import { z } from 'zod'
import type { components } from '@/types/generated/veodyn-api'

type Schemas = components['schemas']

export type ChatResultColumn = Schemas['ChatResultColumnIn']
export type ChatQueryResult = Schemas['ChatQueryResultIn']
export type ChatLibraryResult = Schemas['ChatLibraryResultIn']
export type ChatLibraryItem = Schemas['ChatLibraryItemIn']
export type ChatSavedVisualizationResult = Schemas['ChatSavedVisualizationResultIn']
export type ChatVisualizationRef = Schemas['ChatVisualizationRefIn']
export type ChatDashboardResult = Schemas['ChatDashboardResultIn']
export type ChatDashboardWidget = Schemas['ChatDashboardWidgetIn']
export type ChatToolResult = ChatQueryResult | ChatLibraryResult | ChatSavedVisualizationResult | ChatDashboardResult
export type ChatResultKind = ChatToolResult['kind']

const id = z.number().int().positive()
const stamp = z.string().max(64).optional()
const tags = z.array(z.string().max(64)).max(10)
const base = { ok: z.boolean(), error: z.string().max(500).optional() }

const columnSchema = z
  .object({
    name: z.string().max(255),
    type: z.string().max(64),
    nulls: z.number().int().nonnegative(),
    distinct: z.number().int().nonnegative(),
    distinctCapped: z.boolean(),
    min: z.unknown().optional(),
    max: z.unknown().optional(),
    top: z.array(z.record(z.unknown())).max(3).optional(),
  })
  .strict()

const rows = {
  rowCount: z.number().int().nonnegative().optional(),
  truncated: z.boolean().optional(),
  columns: z.array(columnSchema).max(500).optional(),
  sample: z.array(z.record(z.unknown())).max(50).optional(),
}

export const queryResultSchema = z.object({ ...base, ...rows, kind: z.literal('query_result') }).strict()

export const libraryItemSchema = z
  .object({
    type: z.enum(['query', 'dashboard']),
    id,
    name: z.string().max(500),
    description: z.string().max(300).optional(),
    tags: tags.optional(),
    updatedAt: stamp,
    hasResult: z.boolean().optional(),
  })
  .strict()

export const libraryResultSchema = z
  .object({
    ...base,
    kind: z.literal('library'),
    items: z.array(libraryItemSchema).max(20).optional(),
    more: z.boolean().optional(),
  })
  .strict()

export const visualizationRefSchema = z
  .object({ id, name: z.string().max(500), type: z.string().max(64) })
  .strict()

export const savedVisualizationResultSchema = z
  .object({
    ...base,
    ...rows,
    kind: z.literal('saved_visualization'),
    query: z
      .object({
        id,
        name: z.string().max(500),
        description: z.string().max(4_000).optional(),
        sql: z.string().max(8_000).optional(),
        dataSourceId: id.optional(),
        parameters: z.array(z.string().max(255)).max(50).optional(),
        updatedAt: stamp,
      })
      .strict()
      .optional(),
    visualization: visualizationRefSchema.optional(),
    visualizations: z.array(visualizationRefSchema).max(20).optional(),
    retrievedAt: stamp,
  })
  .strict()

export const dashboardWidgetSchema = z
  .object({
    title: z.string().max(500),
    queryId: id,
    queryName: z.string().max(500).optional(),
    visualizationId: id,
    visualizationType: z.string().max(64),
  })
  .strict()

export const dashboardResultSchema = z
  .object({
    ...base,
    kind: z.literal('dashboard'),
    dashboard: z
      .object({ id, name: z.string().max(500), tags: tags.optional(), updatedAt: stamp })
      .strict()
      .optional(),
    widgets: z.array(dashboardWidgetSchema).max(50).optional(),
    textWidgets: z.number().int().nonnegative().optional(),
  })
  .strict()

export const toolResultSchema = z.discriminatedUnion('kind', [
  queryResultSchema,
  libraryResultSchema,
  savedVisualizationResultSchema,
  dashboardResultSchema,
]) satisfies z.ZodType<ChatToolResult, z.ZodTypeDef, unknown>

export const ERROR_CHARS = 500

export function failedResult(kind: ChatResultKind, error: unknown): ChatToolResult {
  const message = error instanceof Error ? error.message : String(error)
  return { kind, ok: false, error: (message || 'The request failed.').slice(0, ERROR_CHARS) }
}
