import { z } from 'zod'

const positive = z.number().int().positive()
const options = z.record(z.unknown())

export const MAX_VIZ_OPERATIONS = 50

export const vizNextSchema = z
  .object({ type: z.string().min(1).max(64), name: z.string().min(1).max(500), options })
  .strict()

export const vizSnapshotSchema = z
  .object({ type: z.string().max(64), name: z.string().max(500), options, updatedAt: z.string().max(64) })
  .strict()

export const operationSchema = z.object({ path: z.string().min(1).max(500), value: z.unknown() }).strict()

export const vizOperationsShape = {
  set: z.array(operationSchema).max(MAX_VIZ_OPERATIONS).optional(),
  unset: z.array(z.string().min(1).max(500)).max(MAX_VIZ_OPERATIONS).optional(),
}

export const vizPayloadSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('new'), queryId: positive, next: vizNextSchema }).strict(),
  z
    .object({
      mode: z.literal('edit'),
      queryId: positive,
      visualizationId: positive,
      snapshot: vizSnapshotSchema,
      next: vizNextSchema,
    })
    .strict(),
  z
    .object({ mode: z.literal('delete'), queryId: positive, visualizationId: positive, snapshot: vizSnapshotSchema })
    .strict(),
])

export type VizPayload = z.infer<typeof vizPayloadSchema>
export type VizNext = z.infer<typeof vizNextSchema>
