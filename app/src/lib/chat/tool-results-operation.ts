import { z } from 'zod'
import type { components } from '@/types/generated/veodyn-api'
import { operationNameSchema, operationSnapshotSchema, operationTargetSchema } from './operation-changes'

type Schemas = components['schemas']

export type ChatOperationCheckResult = Schemas['ChatOperationCheckResultIn']
export type ChatDownloadResult = Schemas['ChatDownloadResultIn']

export const MAX_OPERATION_PROBLEMS = 10
export const MAX_OPERATION_PARAMS = 20
const MAX_HREF_CHARS = 300

const base = { ok: z.boolean(), error: z.string().max(500).nullish() }

export const operationCheckResultSchema = z
  .object({
    ...base,
    kind: z.literal('operation_check'),
    op: operationNameSchema.nullish(),
    target: operationTargetSchema.nullish(),
    params: z
      .record(z.unknown())
      .refine((params) => Object.keys(params).length <= MAX_OPERATION_PARAMS)
      .optional(),
    destructive: z.boolean(),
    snapshot: operationSnapshotSchema.nullish(),
    problems: z.array(z.string().max(500)).max(MAX_OPERATION_PROBLEMS).optional(),
  })
  .strict()

export const downloadResultSchema = z
  .object({
    ...base,
    kind: z.literal('download'),
    queryId: z.number().int().positive().nullish(),
    format: z.enum(['csv', 'xlsx']).nullish(),
    href: z.string().max(MAX_HREF_CHARS).nullish(),
  })
  .strict()

export function downloadHref(queryId: number, format: 'csv' | 'xlsx'): string {
  return `/api/node/queries/${queryId}/results.${format}`
}
