import { chatId, notFound, relayChatJson, TOOL_RESULT_MAX_BYTES } from '@/lib/chat/relay'
import { acceptedSchema, toolResultRequestSchema } from '@/lib/chat/wire'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = chatId((await ctx.params).id)
  if (!id) return notFound()
  return relayChatJson(request, {
    method: 'POST',
    path: `turns/${id}/tool-results`,
    requestSchema: toolResultRequestSchema,
    responseSchema: acceptedSchema,
    maxRequestBytes: TOOL_RESULT_MAX_BYTES,
  })
}
