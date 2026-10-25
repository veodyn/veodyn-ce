import { chatId, notFound, relayChatJson } from '@/lib/chat/relay'
import { threadSubjectResponseSchema } from '@/lib/chat/wire'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = chatId((await ctx.params).id)
  if (!id) return notFound()
  return relayChatJson(request, {
    method: 'GET',
    path: `threads/${id}/subject`,
    responseSchema: threadSubjectResponseSchema,
  })
}
