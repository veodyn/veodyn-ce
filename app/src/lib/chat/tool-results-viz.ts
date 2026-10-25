import { z } from 'zod'
import type { components } from '@/types/generated/veodyn-api'
import { vizNextSchema, vizSnapshotSchema } from './viz-changes'

type Schemas = components['schemas']

export type ChatVizTypeResult = Schemas['ChatVizTypeResultIn']
export type ChatVizCheckResult = Schemas['ChatVizCheckResultIn']

const base = { ok: z.boolean(), error: z.string().max(500).optional() }

export const vizTypeResultSchema = z
  .object({
    ...base,
    kind: z.literal('visualization_type'),
    type: z.string().max(64).nullish(),
    label: z.string().max(200).nullish(),
    options: z.array(z.record(z.unknown())).max(80).nullish(),
  })
  .strict()

export const vizCheckResultSchema = z
  .object({
    ...base,
    kind: z.literal('visualization_check'),
    mode: z.enum(['new', 'edit', 'delete']).nullish(),
    queryId: z.number().int().positive().nullish(),
    visualizationId: z.number().int().positive().nullish(),
    snapshot: vizSnapshotSchema.nullish(),
    next: vizNextSchema.nullish(),
    problems: z.array(z.string().max(500)).max(20).optional(),
  })
  .strict()
