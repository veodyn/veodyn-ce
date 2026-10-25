import { z } from 'zod'
import { savedQueryParametersSchema } from './saved-query-parameters'

const id = z.string().min(1).max(128)
const positive = z.number().int().positive()
const stamp = z.string().max(64)
const nonNegative = z.number().int().nonnegative()
const MAX_TEXT_CHARS = 4_000

export const GRID_COLUMNS = 6
export const MAX_ROW_SPAN = 40
export const MAX_DASHBOARD_OPERATIONS = 30
export const MAX_SNAPSHOT_WIDGETS = 500
export const MAX_DASHBOARD_TAGS = 10
export const MAX_DASHBOARD_TAG_CHARS = 64

export const MAPPING_TYPES = ['dashboard-add-new', 'dashboard-map-to-existing', 'widget-level', 'static-value'] as const

export type MappingType = (typeof MAPPING_TYPES)[number]

export const parameterMappingSchema = z
  .object({
    type: z.enum(MAPPING_TYPES),
    mapTo: z.string().max(100).nullish(),
    value: z.unknown().optional(),
    title: z.string().max(255).nullish(),
  })
  .strict()

export const parameterMappingsSchema = z.record(z.string().min(1).max(255), parameterMappingSchema).refine(
  (value) => Object.keys(value).length <= 50
)

export type ParameterMappingValue = z.infer<typeof parameterMappingSchema>

export const gridPositionSchema = z
  .object({ col: nonNegative, row: nonNegative, sizeX: nonNegative, sizeY: nonNegative })
  .strict()

export const placedPositionSchema = z
  .object({
    col: z.number().int().min(0).max(GRID_COLUMNS - 1),
    row: nonNegative,
    sizeX: z.number().int().min(1).max(GRID_COLUMNS),
    sizeY: z.number().int().min(1).max(MAX_ROW_SPAN),
  })
  .strict()
  .refine((position) => position.col + position.sizeX <= GRID_COLUMNS)

export type GridPosition = z.infer<typeof gridPositionSchema>

const text = z.string().min(1).max(MAX_TEXT_CHARS)

export const dashboardOperationArgsSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('add'),
      queryId: positive.optional(),
      visualizationId: positive.optional(),
      queryDraftId: z.string().min(1).max(64).optional(),
      position: placedPositionSchema.optional(),
      parameterMappings: parameterMappingsSchema.optional(),
    })
    .strict(),
  z.object({ op: z.literal('addText'), text, position: placedPositionSchema.optional() }).strict(),
  z.object({ op: z.literal('editText'), widgetId: positive, text }).strict(),
  z.object({ op: z.literal('remove'), widgetId: positive }).strict(),
  z.object({ op: z.literal('move'), widgetId: positive, position: placedPositionSchema }).strict(),
])

export const dashboardUpdateArgsShape = {
  dashboardId: positive,
  name: z.string().min(1).max(200).optional(),
  tags: z.array(z.string().min(1).max(MAX_DASHBOARD_TAG_CHARS)).max(MAX_DASHBOARD_TAGS).optional(),
  operations: z.array(dashboardOperationArgsSchema).min(1).max(MAX_DASHBOARD_OPERATIONS).optional(),
}

const title = z.string().max(500)

export const resolvedOperationSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('add'),
      position: placedPositionSchema,
      title,
      queryId: positive.optional(),
      visualizationId: positive.optional(),
      queryDraftId: z.string().min(1).max(64).optional(),
      parameterMappings: parameterMappingsSchema.optional(),
    })
    .strict(),
  z.object({ op: z.literal('addText'), position: placedPositionSchema, text }).strict(),
  z
    .object({
      op: z.literal('editText'),
      position: placedPositionSchema,
      widgetId: positive,
      title,
      updatedAt: stamp.min(1),
      text,
    })
    .strict(),
  z
    .object({ op: z.literal('remove'), position: placedPositionSchema, widgetId: positive, title, updatedAt: stamp.min(1) })
    .strict(),
  z
    .object({ op: z.literal('move'), position: placedPositionSchema, widgetId: positive, title, updatedAt: stamp.min(1) })
    .strict(),
])

export type DashboardOperation = z.infer<typeof resolvedOperationSchema>

export const snapshotWidgetSchema = z
  .object({
    widgetId: positive,
    kind: z.enum(['visualization', 'text']),
    title,
    position: gridPositionSchema,
    updatedAt: stamp.nullish(),
  })
  .strict()

export const dashboardSnapshotSchema = z
  .object({
    name: title,
    tags: z.array(z.string().max(MAX_DASHBOARD_TAG_CHARS)).max(MAX_DASHBOARD_TAGS).optional(),
    version: z.number().int().nullish(),
    updatedAt: stamp.nullish(),
    widgets: z.array(snapshotWidgetSchema).max(MAX_SNAPSHOT_WIDGETS).optional(),
  })
  .strict()

export type DashboardSnapshot = z.infer<typeof dashboardSnapshotSchema>

export const dashboardEditPayloadSchema = z
  .object({
    dashboardId: positive,
    snapshot: dashboardSnapshotSchema,
    name: z.string().min(1).max(200).optional(),
    tags: z.array(z.string().min(1).max(MAX_DASHBOARD_TAG_CHARS)).max(MAX_DASHBOARD_TAGS).optional(),
    operations: z.array(resolvedOperationSchema).max(MAX_DASHBOARD_OPERATIONS),
  })
  .strict()

export type DashboardEditPayload = z.infer<typeof dashboardEditPayloadSchema>

export const dashboardItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('draft'), queryDraftId: id, title: z.string().max(500).optional() }).strict(),
  z
    .object({
      kind: z.literal('existing'),
      queryId: positive,
      visualizationId: positive,
      title: z.string().max(500).optional(),
      parameters: savedQueryParametersSchema.optional(),
    })
    .strict(),
  z.object({ kind: z.literal('text'), text }).strict(),
])

export const dashboardProposalSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(1_000),
    items: z.array(dashboardItemSchema).min(1).max(12),
  })
  .strict()
