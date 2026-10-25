import { z } from 'zod'
import type { components } from '@/types/generated/veodyn-api'
import {
  dashboardSnapshotSchema,
  gridPositionSchema,
  MAX_DASHBOARD_OPERATIONS,
  parameterMappingsSchema,
  resolvedOperationSchema,
} from './dashboard-changes'

type Schemas = components['schemas']

export type ChatDashboardEditResult = Schemas['ChatDashboardEditResultIn']

const id = z.number().int().positive()
const stamp = z.string().max(64)
const base = { ok: z.boolean(), error: z.string().max(500).optional() }
const MAX_WIDGET_TEXT_CHARS = 4_000
const MAX_PROBLEMS = 20

export const dashboardWidgetSchema = z
  .object({
    widgetId: id,
    kind: z.enum(['visualization', 'text']),
    title: z.string().max(500),
    queryId: id.nullish(),
    queryName: z.string().max(500).nullish(),
    visualizationId: id.nullish(),
    visualizationType: z.string().max(64).nullish(),
    text: z.string().max(MAX_WIDGET_TEXT_CHARS).nullish(),
    position: gridPositionSchema,
    parameterMappings: parameterMappingsSchema.nullish(),
    updatedAt: stamp.nullish(),
  })
  .strict()

export const dashboardResultSchema = z
  .object({
    ...base,
    kind: z.literal('dashboard'),
    dashboard: z
      .object({
        id,
        name: z.string().max(500),
        tags: z.array(z.string().max(64)).max(10).optional(),
        version: z.number().int().nullish(),
        updatedAt: stamp.nullish(),
        canEdit: z.boolean().nullish(),
      })
      .strict()
      .optional(),
    widgets: z.array(dashboardWidgetSchema).max(50).optional(),
    widgetCount: z.number().int().nonnegative().optional(),
    textWidgets: z.number().int().nonnegative().optional(),
  })
  .strict()

export const dashboardEditResultSchema = z
  .object({
    ...base,
    kind: z.literal('dashboard_edit'),
    dashboardId: id.nullish(),
    snapshot: dashboardSnapshotSchema.nullish(),
    name: z.string().min(1).max(200).nullish(),
    tags: z.array(z.string().min(1).max(64)).max(10).nullish(),
    operations: z.array(resolvedOperationSchema).max(MAX_DASHBOARD_OPERATIONS).optional(),
    problems: z.array(z.string().max(500)).max(MAX_PROBLEMS).optional(),
  })
  .strict()
