import { z } from 'zod'
import type { components } from '@/types/generated/veodyn-api'

type Schemas = components['schemas']

export type ChatQueryDetailResult = Schemas['ChatQueryDetailResultIn']
export type ChatQueryEditResult = Schemas['ChatQueryEditResultIn']
export type ChatQuerySnapshot = Schemas['ChatQuerySnapshotIn']

export const MAX_QUERY_SQL_CHARS = 50_000
export const MAX_QUERY_PARAMETERS = 20
export const MAX_QUERY_DESCRIPTION_CHARS = 4_096

const id = z.number().int().positive()
const base = { ok: z.boolean(), error: z.string().max(500).optional() }
const parameters = z.array(z.record(z.unknown())).max(MAX_QUERY_PARAMETERS)
const tags = z.array(z.string().max(64)).max(20)
const schedule = z.record(z.unknown()).nullable()

const snapshotFields = {
  id,
  name: z.string().max(500),
  description: z.string().max(MAX_QUERY_DESCRIPTION_CHARS).nullish(),
  sql: z.string().max(MAX_QUERY_SQL_CHARS),
  dataSourceId: id,
  parameters: parameters.optional(),
  tags: tags.optional(),
  schedule: schedule.optional(),
  isDraft: z.boolean(),
  updatedAt: z.string().max(64),
}

export const querySnapshotSchema = z.object(snapshotFields).strict()

export const queryDetailResultSchema = z
  .object({
    ...base,
    kind: z.literal('query_detail'),
    query: z
      .object({
        ...snapshotFields,
        canEdit: z.boolean(),
        visualizations: z
          .array(z.object({ id, name: z.string().max(500), type: z.string().max(64) }).strict())
          .max(20)
          .optional(),
      })
      .strict()
      .nullish(),
  })
  .strict()

export const queryEditResultSchema = z
  .object({
    ...base,
    kind: z.literal('query_edit'),
    queryId: id.nullish(),
    snapshot: querySnapshotSchema.nullish(),
    changes: z.record(z.unknown()).nullish(),
  })
  .strict()
