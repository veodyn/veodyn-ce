import { z } from 'zod'

export const MAX_SAVED_QUERY_PARAMETERS = 20

export const savedQueryParameterSchema = z.union([
  z.string().max(500),
  z.number(),
  z.array(z.string().max(500)).max(50),
  z.object({ start: z.string().max(64), end: z.string().max(64) }).strict(),
])

export const savedQueryParametersSchema = z
  .record(savedQueryParameterSchema)
  .refine((value) => Object.keys(value).length <= MAX_SAVED_QUERY_PARAMETERS)

export type SavedQueryParameters = z.infer<typeof savedQueryParametersSchema>
