import { z } from 'zod'

const trigger = z.string().min(1).max(255)
const body = z.string().min(1).max(10_000)
const description = z.string().max(1_000)

export const snippetDraftSchema = z.object({ trigger, snippet: body, description }).strict()

export const snippetEditDraftSchema = z
  .object({
    snippetId: z.number().int().positive(),
    snapshot: z.object({ trigger, snippet: body, description, updatedAt: z.string().max(64) }).strict(),
    changes: z.object({ trigger: trigger.optional(), snippet: body.optional(), description: description.optional() }).strict(),
    delete: z.literal(true).optional(),
  })
  .strict()

export type SnippetDraft = z.infer<typeof snippetDraftSchema>
export type SnippetEditDraft = z.infer<typeof snippetEditDraftSchema>

export function parseSnippetDraft(payload: unknown): SnippetDraft | null {
  const parsed = snippetDraftSchema.safeParse(payload)
  return parsed.success ? parsed.data : null
}

export function parseSnippetEditDraft(payload: unknown): SnippetEditDraft | null {
  const parsed = snippetEditDraftSchema.safeParse(payload)
  return parsed.success ? parsed.data : null
}
