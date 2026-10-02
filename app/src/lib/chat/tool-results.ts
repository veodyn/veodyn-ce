import { z } from 'zod'
import type { components } from '@/types/generated/veodyn-api'
import { KPI_SLUG } from './frames'

type Schemas = components['schemas']

export type ChatResultColumn = Schemas['ChatResultColumnIn']
export type ChatQueryResult = Schemas['ChatQueryResultIn']
export type ChatLibraryResult = Schemas['ChatLibraryResultIn']
export type ChatLibraryItem = Schemas['ChatLibraryItemIn']
export type ChatSavedVisualizationResult = Schemas['ChatSavedVisualizationResultIn']
export type ChatVisualizationRef = Schemas['ChatVisualizationRefIn']
export type ChatDashboardResult = Schemas['ChatDashboardResultIn']
export type ChatDashboardWidget = Schemas['ChatDashboardWidgetIn']
export type ChatDataSourceRef = Schemas['ChatDataSourceRefIn']
export type ChatDataSourcesResult = Schemas['ChatDataSourcesResultIn']
export type ChatDataSourceTable = Schemas['ChatDataSourceTableIn']
export type ChatDataSourceResource = Schemas['ChatDataSourceResourceIn']
export type ChatDataSourceSchemaResult = Schemas['ChatDataSourceSchemaResultIn']
export type ChatKpiResult = Schemas['ChatKpiResultIn']
export type ChatKpiListResult = Schemas['ChatKpiListResultIn']
export type ChatKpiListItem = Schemas['ChatKpiListItemIn']
export type ChatKpiPoint = Schemas['ChatKpiPointIn']
export type ChatToolResult =
  | ChatQueryResult
  | ChatLibraryResult
  | ChatSavedVisualizationResult
  | ChatDashboardResult
  | ChatDataSourcesResult
  | ChatDataSourceSchemaResult
  | ChatKpiResult
  | ChatKpiListResult
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

export const queryResultSchema = z
  .object({ ...base, ...rows, kind: z.literal('query_result'), dataSourceId: id.optional() })
  .strict()

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
    widgetCount: z.number().int().nonnegative().optional(),
    textWidgets: z.number().int().nonnegative().optional(),
  })
  .strict()

export const dataSourceRefSchema = z
  .object({ id, name: z.string().max(500), type: z.string().max(64), syntax: z.string().max(32), viewOnly: z.boolean() })
  .strict()

export const dataSourcesResultSchema = z
  .object({
    ...base,
    kind: z.literal('data_sources'),
    sources: z.array(dataSourceRefSchema).max(50).optional(),
  })
  .strict()

export const dataSourceTableSchema = z
  .object({ name: z.string().max(255), columns: z.array(z.string().max(255)).max(100) })
  .strict()

export const dataSourceResourceSchema = z
  .object({
    name: z.string().max(128),
    params: z.array(z.string().max(128)).max(50),
    returns: z.array(z.string().max(255)).max(50),
    example: z.string().max(500).optional(),
  })
  .strict()

export const dataSourceSchemaResultSchema = z
  .object({
    ...base,
    kind: z.literal('data_source_schema'),
    dataSourceId: id,
    syntax: z.string().max(32).optional(),
    tables: z.array(dataSourceTableSchema).max(200).optional(),
    resources: z.array(dataSourceResourceSchema).max(50).optional(),
  })
  .strict()

const kpiId = z.string().min(1).max(255).regex(KPI_SLUG)
const metricStatus = z.enum(['on-track', 'at-risk', 'breached', 'no-data'])
const shortText = z.string().max(255).nullish()
const unit = z.string().max(32).nullish()

export const kpiPointSchema = z.object({ at: z.string().max(64), value: z.number(), status: metricStatus }).strict()

export const kpiResultSchema = z
  .object({
    ...base,
    kind: z.literal('kpi'),
    kpi: z
      .object({
        id: kpiId,
        name: z.string().max(500),
        description: z.string().max(2_000).nullish(),
        domain: shortText,
        unit,
        cadence: z.enum(['hourly', 'daily', 'weekly']).nullish(),
        owner: shortText,
        target: z
          .object({ value: z.number(), direction: z.enum(['higher-is-better', 'lower-is-better']) })
          .strict()
          .nullish(),
        thresholds: z.object({ atRisk: z.number(), breached: z.number() }).strict().nullish(),
      })
      .strict()
      .optional(),
    evaluation: z
      .object({
        value: z.number(),
        status: metricStatus,
        delta: z.number().nullish(),
        asOf: z.string().max(64),
        stale: z.boolean(),
      })
      .strict()
      .optional(),
    history: z.array(kpiPointSchema).max(200).optional(),
    lastError: z.string().max(500).nullish(),
    retrievedAt: stamp,
  })
  .strict()

export const kpiListItemSchema = z
  .object({
    id: kpiId,
    name: z.string().max(500),
    domain: shortText,
    unit,
    value: z.number().nullish(),
    status: metricStatus,
    delta: z.number().nullish(),
    asOf: z.string().max(64).nullish(),
    stale: z.boolean().nullish(),
  })
  .strict()

export const kpiListResultSchema = z
  .object({
    ...base,
    kind: z.literal('kpi_list'),
    items: z.array(kpiListItemSchema).max(50).optional(),
    more: z.boolean().optional(),
  })
  .strict()

export const toolResultSchema = z.discriminatedUnion('kind', [
  queryResultSchema,
  libraryResultSchema,
  savedVisualizationResultSchema,
  dashboardResultSchema,
  dataSourcesResultSchema,
  dataSourceSchemaResultSchema,
  kpiResultSchema,
  kpiListResultSchema,
]) satisfies z.ZodType<ChatToolResult, z.ZodTypeDef, unknown>

export const ERROR_CHARS = 500

export function failedResult(kind: Exclude<ChatResultKind, 'data_source_schema'>, error: unknown): ChatToolResult {
  const message = error instanceof Error ? error.message : String(error)
  return { kind, ok: false, error: (message || 'The request failed.').slice(0, ERROR_CHARS) }
}
