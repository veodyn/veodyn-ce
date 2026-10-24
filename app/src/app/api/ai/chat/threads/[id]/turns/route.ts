import { chatId, notFound, relayChatJson } from '@/lib/chat/relay'
import { buildTurnContext } from '@/lib/chat/turn-context-builder'
import { vizCatalog } from '@/lib/chat/viz-catalog'
import { turnRequestSchema, turnStartedSchema } from '@/lib/chat/wire'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = chatId((await ctx.params).id)
  if (!id) return notFound()
  return relayChatJson(request, {
    method: 'POST',
    path: `threads/${id}/turns`,
    requestSchema: turnRequestSchema,
    responseSchema: turnStartedSchema,
    extend: async (incoming) => ({ vizCatalog: vizCatalog(), ...(await buildTurnContext(incoming)) }),
  })
}
