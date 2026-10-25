import { chatId, notFound, relayChatJson } from '@/lib/chat/relay'
import { buildTurnContext } from '@/lib/chat/turn-context-builder'
import { vizCatalog } from '@/lib/chat/viz-catalog'
import { subjectDetailFor } from '@/lib/chat/turn-subject'
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
    extend: async (incoming, gate) => {
      const [context, subjectDetail] = await Promise.all([
        buildTurnContext(incoming),
        subjectDetailFor(incoming, id, gate),
      ])
      return { vizCatalog: vizCatalog(), ...context, ...(subjectDetail ? { subjectDetail } : {}) }
    },
  })
}
