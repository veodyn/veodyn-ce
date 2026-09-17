import { chatId, notFound } from '@/lib/chat/relay'
import { relayChatStream } from '@/lib/chat/stream-relay'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = chatId((await ctx.params).id)
  if (!id) return notFound()
  return relayChatStream(request, id)
}
