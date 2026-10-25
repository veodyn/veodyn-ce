import { z } from 'zod'
import type { components } from '@/types/generated/veodyn-api'

type Schemas = components['schemas']

export type ChatSnippetCheckResult = Schemas['ChatSnippetCheckResultIn']
export type ChatKpiCheckResult = Schemas['ChatKpiCheckResultIn']

const base = { ok: z.boolean(), error: z.string().max(500).nullish() }

export const snippetSnapshotSchema = z
  .object({
    trigger: z.string().max(255),
    snippet: z.string().max(10_000),
    description: z.string().max(1_000).nullish(),
    updatedAt: z.string().max(64),
  })
  .strict()

export const snippetCheckResultSchema = z
  .object({
    ...base,
    kind: z.literal('snippet_check'),
    mode: z.enum(['edit', 'delete']).nullish(),
    snippetId: z.number().int().positive().nullish(),
    snapshot: snippetSnapshotSchema.nullish(),
    changes: z.record(z.unknown()).nullish(),
  })
  .strict()

export const MAX_CHECKED_COLUMNS = 500

export const kpiCheckResultSchema = z
  .object({
    ...base,
    kind: z.literal('kpi_check'),
    sourceQueryId: z.number().int().positive().nullish(),
    queryDraftId: z.string().max(64).nullish(),
    queryName: z.string().max(500).nullish(),
    columns: z.array(z.string().max(255)).max(MAX_CHECKED_COLUMNS).optional(),
  })
  .strict()
