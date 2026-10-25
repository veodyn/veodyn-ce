import { z } from 'zod'
import { MAX_QUERY_DESCRIPTION_CHARS, querySnapshotSchema } from './tool-results-query'

export const PARAMETER_TYPES = [
  'text',
  'number',
  'enum',
  'query',
  'date',
  'datetime-local',
  'datetime-with-seconds',
  'date-range',
  'datetime-range',
  'datetime-range-with-seconds',
] as const

export const parameterDefinitionSchema = z
  .object({
    name: z.string().min(1).max(255),
    title: z.string().max(255).optional(),
    type: z.enum(PARAMETER_TYPES),
    value: z.unknown().optional(),
    enumOptions: z.string().max(4_000).optional(),
    queryId: z.number().int().positive().optional(),
    multi: z.boolean().optional(),
    quote: z.enum(['none', 'single', 'double']).optional(),
  })
  .strict()

export const parameterListSchema = z.array(parameterDefinitionSchema).max(20)

export const scheduleSchema = z
  .object({
    interval: z.number().int().nonnegative(),
    time: z.string().max(8).nullish(),
    dayOfWeek: z.string().max(16).nullish(),
    until: z.string().max(32).nullish(),
  })
  .strict()

export const queryChangesSchema = z
  .object({
    sql: z.string().min(1).max(50_000),
    name: z.string().min(1).max(255),
    description: z.string().max(MAX_QUERY_DESCRIPTION_CHARS).nullable(),
    dataSourceId: z.number().int().positive(),
    tags: z.array(z.string().min(1).max(64)).max(20),
    parameters: parameterListSchema,
    schedule: scheduleSchema.nullable(),
    isDraft: z.boolean(),
  })
  .partial()
  .strict()

export type QueryChanges = z.infer<typeof queryChangesSchema>

export const queryEditPayloadSchema = z
  .object({
    queryId: z.number().int().positive(),
    snapshot: querySnapshotSchema,
    changes: queryChangesSchema,
  })
  .strict()

export type QueryEditPayload = z.infer<typeof queryEditPayloadSchema>
